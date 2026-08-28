import {
	getHostedUserQuestionRequest,
	hostedUserQuestionDecisionsMatch,
	resolveHostedUserQuestionMessage,
} from "@workspace/ai/hosted-user-question";
import { decodeStoredUiMessage } from "@workspace/ai/ui-message-codec";
import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireConvexDocumentWithinLimit } from "./documentSize";

type UserQuestionDecision = Extract<
	NonNullable<Doc<"assistantRuns">["pendingDecision"]>,
	{ type: "user_question" }
>;

const requireStoredUserQuestion = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	decision: UserQuestionDecision,
) => {
	const storedMessage = await ctx.db
		.query("chatMessages")
		.withIndex("by_chatId_and_messageId", (q) =>
			q.eq("chatId", run.chatId).eq("messageId", decision.assistantMessageId),
		)
		.unique();
	if (
		!storedMessage ||
		storedMessage.ownerTokenIdentifier !== run.ownerTokenIdentifier ||
		storedMessage.role !== "assistant"
	) {
		throw new ConvexError({
			code: "USER_QUESTION_INVALID",
			message: "Stored assistant question was not found.",
		});
	}

	let questionMessage: Awaited<ReturnType<typeof decodeStoredUiMessage>> | null;
	try {
		questionMessage = await decodeStoredUiMessage({
			id: storedMessage.messageId,
			role: storedMessage.role,
			partsJson: storedMessage.partsJson,
			metadataJson: storedMessage.metadataJson,
			createdAt: storedMessage.createdAt,
		});
	} catch {
		questionMessage = null;
	}
	const storedDecision = questionMessage
		? getHostedUserQuestionRequest(questionMessage)
		: null;
	if (
		!questionMessage ||
		!storedDecision ||
		!hostedUserQuestionDecisionsMatch(storedDecision, decision)
	) {
		throw new ConvexError({
			code: "USER_QUESTION_INVALID",
			message: "Stored assistant question does not match the pending request.",
		});
	}
	return { questionMessage, storedMessage };
};

export const requireAssistantRunUserQuestion = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	decision: UserQuestionDecision,
) => {
	await requireStoredUserQuestion(ctx, run, decision);
};

export const persistAssistantRunUserQuestionResolution = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	decision: UserQuestionDecision,
	answer: string,
) => {
	if (!answer.trim()) {
		throw new ConvexError({
			code: "USER_QUESTION_ANSWER_INVALID",
			message: "Assistant question answer is missing.",
		});
	}

	const { questionMessage, storedMessage } = await requireStoredUserQuestion(
		ctx,
		run,
		decision,
	);
	const answeredMessage = resolveHostedUserQuestionMessage({
		message: questionMessage,
		decision,
		answer,
	});
	if (!answeredMessage) {
		throw new ConvexError({
			code: "USER_QUESTION_ANSWER_INVALID",
			message: "Assistant question answer did not match its request.",
		});
	}

	const partsJson = JSON.stringify(answeredMessage.parts);
	const replacement = {
		chatId: storedMessage.chatId,
		ownerTokenIdentifier: storedMessage.ownerTokenIdentifier,
		messageId: storedMessage.messageId,
		role: storedMessage.role,
		partsJson,
		metadataJson: storedMessage.metadataJson,
		text: storedMessage.text,
		createdAt: storedMessage.createdAt,
	};
	requireConvexDocumentWithinLimit({
		document: {
			...replacement,
			_id: storedMessage._id,
			_creationTime: storedMessage._creationTime,
		},
		errorCode: "CHAT_MESSAGE_TOO_LARGE",
		message: "Chat message exceeds Convex's 1 MiB document limit.",
	});
	await ctx.db.replace(storedMessage._id, replacement);
	return {
		id: storedMessage.messageId,
		role: "assistant" as const,
		partsJson,
		metadataJson: storedMessage.metadataJson,
	};
};
