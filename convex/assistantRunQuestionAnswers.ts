import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { consumeChatTurnAdmissionReservation } from "./aiAdmissionReservations";
import { requireOwnedActiveChatAndRun } from "./assistantRunLifecycle";
import { scheduleAssistantRunExecution } from "./assistantRunScheduling";
import {
	cleanupAssistantRunSnapshots,
	transitionAssistantRun,
} from "./assistantRunStateMachine";
import {
	createAssistantRunStream,
	getActiveStreamForRun,
} from "./assistantRunStreamState";
import { resolveAssistantRunUserQuestion } from "./assistantRunUserQuestions";
import { createResourceAccess } from "./domain";

const { requireIdentity } = createResourceAccess("assistantRuns");

export const answer = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		admissionReservationId: v.optional(v.id("aiAdmissionReservations")),
		nextAssistantMessageId: v.string(),
		answer: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		if (!args.nextAssistantMessageId.trim()) {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Question continuation assistant message id cannot be empty.",
			});
		}
		if (!args.answer.trim()) {
			throw new ConvexError({
				code: "USER_QUESTION_ANSWER_INVALID",
				message: "Assistant question answer cannot be empty.",
			});
		}

		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		const { run } = await requireOwnedActiveChatAndRun(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: args.chatId,
			runId: args.runId,
		});
		if (
			run.status !== "waiting_for_user" ||
			run.pendingDecision?.type !== "user_question"
		) {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run is not waiting for a question answer.",
			});
		}

		if (run.producer === "convex") {
			const stream = await getActiveStreamForRun(ctx, run._id);
			if (!stream || stream.assistantMessageId !== run.assistantMessageId) {
				throw new ConvexError({
					code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
					message:
						"Convex assistant run stream does not match its active generation.",
				});
			}
			await consumeChatTurnAdmissionReservation(ctx, {
				ownerTokenIdentifier,
				reservationId: args.admissionReservationId,
			});
		}

		await resolveAssistantRunUserQuestion(ctx, run, args.answer);
		const continuedRun = await transitionAssistantRun(ctx, run, {
			type: "resolve_user_decision",
			resolution: {
				type: "user_question",
				answer: args.answer,
			},
		});
		if (run.producer === "convex") {
			const messageRun = await transitionAssistantRun(ctx, continuedRun, {
				type: "start_assistant_message",
				assistantMessageId: args.nextAssistantMessageId,
			});
			await cleanupAssistantRunSnapshots(ctx, run._id);
			await createAssistantRunStream(ctx, messageRun);
			await scheduleAssistantRunExecution(ctx, messageRun);
		}
		return null;
	},
});
