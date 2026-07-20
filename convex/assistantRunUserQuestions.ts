import { resolveHostedUserQuestionMessage } from "@workspace/ai/hosted-user-question";
import { decodeStoredUiMessage } from "@workspace/ai/ui-message-codec";
import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { upsertAssistantRunJobMessage } from "./assistantRunJobState";
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
			q
				.eq("chatId", run.chatId)
				.eq("messageId", decision.assistantMessageId),
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

	let resolvedMessage;
	try {
		resolvedMessage = resolveHostedUserQuestionMessage({
			message: await decodeStoredUiMessage({
				id: storedMessage.messageId,
				role: storedMessage.role,
				partsJson: storedMessage.partsJson,
				metadataJson: storedMessage.metadataJson,
				createdAt: storedMessage.createdAt,
			}),
			decision,
		});
	} catch {
		resolvedMessage = null;
	}
	if (!resolvedMessage) {
		throw new ConvexError({
			code: "USER_QUESTION_INVALID",
			message: "Stored assistant question does not match the pending request.",
		});
	}
	return { resolvedMessage, storedMessage };
};

export const requireAssistantRunUserQuestion = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	decision: UserQuestionDecision,
) => {
	await requireStoredUserQuestion(ctx, run, decision);
};

export const resolveAssistantRunUserQuestion = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	answerMessageIds: ReadonlyArray<string>,
) => {
	const decision = run.pendingDecision;
	if (run.status !== "waiting_for_user" || decision?.type !== "user_question") {
		return false;
	}
	if (answerMessageIds.length === 0) {
		throw new ConvexError({
			code: "USER_QUESTION_ANSWER_INVALID",
			message: "Assistant question answer is missing.",
		});
	}
	for (const messageId of answerMessageIds) {
		const answerMessage = await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId_and_messageId", (q) =>
				q.eq("chatId", run.chatId).eq("messageId", messageId),
			)
			.unique();
		if (
			!answerMessage ||
			answerMessage.ownerTokenIdentifier !== run.ownerTokenIdentifier ||
			answerMessage.role !== "user"
		) {
			throw new ConvexError({
				code: "USER_QUESTION_ANSWER_INVALID",
				message: "Assistant question answer was not found.",
			});
		}
	}

	const { resolvedMessage, storedMessage } = await requireStoredUserQuestion(
		ctx,
		run,
		decision,
	);

	const partsJson = JSON.stringify(resolvedMessage.parts);
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
	if (run.producer === "convex") {
		await upsertAssistantRunJobMessage(ctx, run._id, {
			id: storedMessage.messageId,
			role: "assistant",
			partsJson,
			metadataJson: storedMessage.metadataJson,
		});
	}
	return true;
};
