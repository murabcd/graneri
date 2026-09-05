import { encodeChatMessageWorkDuration } from "@workspace/ai/chat-message-metadata";
import {
	decodeStoredUiMessage,
	hasUiMessageContent,
} from "@workspace/ai/ui-message-codec";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import { getActiveStreamForRun } from "./assistantRunStreamState";
import { normalizeChatPreview } from "./chatFormatting";
import { writeChatMessage } from "./chatMessagePersistence";

/** Snapshot promotion and its caller's terminal transition share one transaction. */
export const preserveInterruptedAssistantMessage = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
) => {
	const stream = await getActiveStreamForRun(ctx, run._id);
	if (!stream || stream.assistantMessageId !== run.assistantMessageId) return;
	const existing = await ctx.db
		.query("chatMessages")
		.withIndex("by_chatId_and_messageId", (q) =>
			q.eq("chatId", run.chatId).eq("messageId", run.assistantMessageId),
		)
		.unique();
	// A committed final message is authoritative over an older active snapshot.
	if (existing) return;
	const message = await decodeStoredUiMessage({
		id: stream.assistantMessageId,
		role: "assistant",
		partsJson: stream.partsJson,
	});
	if (!stream.text.trim() && !hasUiMessageContent(message)) return;
	const now = Date.now();
	await writeChatMessage(ctx, {
		chatId: run.chatId,
		ownerTokenIdentifier: run.ownerTokenIdentifier,
		messageId: stream.assistantMessageId,
		role: "assistant",
		partsJson: JSON.stringify(message.parts),
		metadataJson: encodeChatMessageWorkDuration({
			metadataJson: JSON.stringify({ interrupted: true }),
			startedAt: run.startedAt,
			completedAt: now,
		}),
		text: stream.text,
		createdAt: now,
	});
	await ctx.db.patch(run.chatId, {
		preview: normalizeChatPreview(stream.text),
		updatedAt: now,
		lastMessageAt: now,
	});
	await appendAssistantRunEvent(ctx, run, {
		type: "assistant.message.interrupted",
		assistantMessageId: stream.assistantMessageId,
	});
};
