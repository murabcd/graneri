import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { consumeChatTurnAdmissionReservation } from "./aiAdmissionReservations";
import {
	projectPersistedAssistantRunJobForNewGeneration,
	upsertAssistantRunJobMessage,
	upsertAssistantRunJobMessages,
} from "./assistantRunJobState";
import { requireOwnedActiveChatAndRun } from "./assistantRunLifecycle";
import type { HumanDecisionResolution } from "./assistantRunModel";
import { scheduleAssistantRunExecution } from "./assistantRunScheduling";
import {
	cleanupAssistantRunSnapshots,
	transitionAssistantRun,
} from "./assistantRunStateMachine";
import {
	deleteAssistantRunSteerInputs,
	loadPendingAssistantRunSteerMessages,
} from "./assistantRunSteerInputState";
import {
	createAssistantRunStream,
	getActiveStreamForRun,
} from "./assistantRunStreamState";
import { persistAssistantRunUserQuestionResolution } from "./assistantRunUserQuestions";
import { hydrateChatMessage } from "./chatMessageContent";
import { writeChatMessage } from "./chatMessagePersistence";
import {
	createCanonicalToolApprovalMessage,
	requireMatchingToolApprovalResponse,
} from "./toolApproval";

type AssistantMessageInput = {
	id: string;
	role: "assistant";
	partsJson: string;
	metadataJson?: string;
	text: string;
	createdAt: number;
};

type HumanDecisionInput =
	| {
			type: "tool_approval";
			message: AssistantMessageInput;
	  }
	| {
			type: "user_question";
			answer: string;
	  };

type ResolveAssistantRunHumanDecisionArgs = {
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
	chatId: string;
	runId: Id<"assistantRuns">;
	nextAssistantMessageId: string;
	admissionReservationId?: Id<"aiAdmissionReservations">;
	decision: HumanDecisionInput;
};

type ToolApprovalPendingDecision = Extract<
	NonNullable<Doc<"assistantRuns">["pendingDecision"]>,
	{ type: "tool_approval" }
>;

type UserQuestionPendingDecision = Extract<
	NonNullable<Doc<"assistantRuns">["pendingDecision"]>,
	{ type: "user_question" }
>;

const requireToolApprovalPendingDecision = (
	run: Doc<"assistantRuns">,
): ToolApprovalPendingDecision => {
	if (
		run.status === "waiting_for_user" &&
		run.pendingDecision?.type === "tool_approval"
	) {
		return run.pendingDecision;
	}

	throw new ConvexError({
		code: "TOOL_APPROVAL_NOT_PENDING",
		message: "Assistant run is not waiting for a tool approval.",
	});
};

const requireUserQuestionPendingDecision = (
	run: Doc<"assistantRuns">,
): UserQuestionPendingDecision => {
	if (
		run.status === "waiting_for_user" &&
		run.pendingDecision?.type === "user_question"
	) {
		return run.pendingDecision;
	}

	throw new ConvexError({
		code: "INVALID_ASSISTANT_RUN_TRANSITION",
		message: "Assistant run is not waiting for a question answer.",
	});
};

const requireMatchingConvexGeneration = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
) => {
	if (run.producer !== "convex") {
		return;
	}

	const stream = await getActiveStreamForRun(ctx, run._id);
	if (!stream || stream.assistantMessageId !== run.assistantMessageId) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
			message:
				"Convex assistant run stream does not match its active generation.",
		});
	}
};

const persistToolApprovalResolution = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	pendingDecision: ToolApprovalPendingDecision,
	message: AssistantMessageInput,
) => {
	const approval = requireMatchingToolApprovalResponse(
		message,
		pendingDecision,
	);
	const existingMessage = await ctx.db
		.query("chatMessages")
		.withIndex("by_chatId_and_messageId", (q) =>
			q
				.eq("chatId", run.chatId)
				.eq("messageId", pendingDecision.assistantMessageId),
		)
		.unique();
	if (!existingMessage) {
		throw new ConvexError({
			code: "TOOL_APPROVAL_INVALID",
			message: "Stored tool approval request was not found.",
		});
	}

	const canonicalMessage = createCanonicalToolApprovalMessage(
		await hydrateChatMessage(ctx, existingMessage),
		pendingDecision,
		approval.responses,
	);
	const storedMessage = {
		chatId: existingMessage.chatId,
		ownerTokenIdentifier: existingMessage.ownerTokenIdentifier,
		messageId: canonicalMessage.id,
		role: canonicalMessage.role,
		partsJson: canonicalMessage.partsJson,
		metadataJson: canonicalMessage.metadataJson,
		text: canonicalMessage.text,
		createdAt: canonicalMessage.createdAt,
	};
	await writeChatMessage(ctx, storedMessage);

	return {
		jobMessage: canonicalMessage,
		resolution: {
			type: "tool_approval",
			approved: approval.approved,
			toolCallId: pendingDecision.toolCallId,
		} satisfies HumanDecisionResolution,
	};
};

const persistUserQuestionResolution = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	pendingDecision: UserQuestionPendingDecision,
	answer: string,
) => ({
	jobMessage: await persistAssistantRunUserQuestionResolution(
		ctx,
		run,
		pendingDecision,
		answer,
	),
	resolution: {
		type: "user_question",
		answer,
	} satisfies HumanDecisionResolution,
});

export const resolveAssistantRunHumanDecision = async (
	ctx: MutationCtx,
	args: ResolveAssistantRunHumanDecisionArgs,
) => {
	if (!args.nextAssistantMessageId.trim()) {
		throw new ConvexError({
			code: "INVALID_ASSISTANT_RUN_TRANSITION",
			message: "Continuation assistant message id cannot be empty.",
		});
	}
	if (args.decision.type === "user_question" && !args.decision.answer.trim()) {
		throw new ConvexError({
			code: "USER_QUESTION_ANSWER_INVALID",
			message: "Assistant question answer cannot be empty.",
		});
	}

	const { run } = await requireOwnedActiveChatAndRun(ctx, {
		ownerTokenIdentifier: args.ownerTokenIdentifier,
		workspaceId: args.workspaceId,
		chatId: args.chatId,
		runId: args.runId,
	});
	const persistResolution = (() => {
		if (args.decision.type === "tool_approval") {
			const decision = args.decision;
			const pendingDecision = requireToolApprovalPendingDecision(run);
			return () =>
				persistToolApprovalResolution(
					ctx,
					run,
					pendingDecision,
					decision.message,
				);
		}

		const decision = args.decision;
		const pendingDecision = requireUserQuestionPendingDecision(run);
		return () =>
			persistUserQuestionResolution(ctx, run, pendingDecision, decision.answer);
	})();
	await requireMatchingConvexGeneration(ctx, run);
	const persistedResolution = await persistResolution();

	if (run.producer === "convex") {
		await consumeChatTurnAdmissionReservation(ctx, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			reservationId: args.admissionReservationId,
		});
		await upsertAssistantRunJobMessage(
			ctx,
			run._id,
			persistedResolution.jobMessage,
		);
		const pendingSteer = await loadPendingAssistantRunSteerMessages(ctx, {
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
		});
		await upsertAssistantRunJobMessages(
			ctx,
			run._id,
			pendingSteer.messages.map((message) => ({
				id: message.messageId,
				role: "user" as const,
				partsJson: message.partsJson,
				metadataJson: message.metadataJson,
			})),
		);
		await deleteAssistantRunSteerInputs(ctx, pendingSteer.inputs);
		await projectPersistedAssistantRunJobForNewGeneration(ctx, run._id);
	}

	await cleanupAssistantRunSnapshots(ctx, run._id);
	const resumedRun = await transitionAssistantRun(ctx, run, {
		type: "resolve_user_decision",
		resolution: persistedResolution.resolution,
		assistantMessageId: args.nextAssistantMessageId,
	});
	if (run.producer === "convex") {
		await createAssistantRunStream(ctx, resumedRun);
		await scheduleAssistantRunExecution(ctx, resumedRun);
	}
};
