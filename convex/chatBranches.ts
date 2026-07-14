import { HOSTED_CHAT_CONTEXT_MESSAGE_LIMIT } from "@workspace/ai/chat-context-contract";
import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { stopActiveRunsForChat } from "./assistantRunCleanup";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import { normalizeChatPreview } from "./chatFormatting";
import { requireConvexDocumentWithinLimit } from "./documentSize";
import { clampWhitespace, createResourceAccess } from "./domain";

const { requireTokenIdentifier } = createResourceAccess("chat branches");

export const branchFromMessage = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		messageId: v.string(),
	},
	returns: v.object({
		branchId: v.id("chatBranches"),
		branchedCount: v.number(),
	}),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);
		const targetMessageId = clampWhitespace(args.messageId);
		if (!chat) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}
		if (!targetMessageId) {
			throw new ConvexError({
				code: "CHAT_BRANCH_TARGET_INVALID",
				message: "Chat branch target is invalid.",
			});
		}

		const messages = await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chat._id))
			.order("desc")
			.take(HOSTED_CHAT_CONTEXT_MESSAGE_LIMIT + 1);
		messages.reverse();
		const targetIndex = messages.findIndex(
			(message) => message.messageId === targetMessageId,
		);
		if (targetIndex < 0) {
			throw new ConvexError({
				code: "CHAT_BRANCH_TARGET_NOT_FOUND",
				message: "Chat branch target is no longer available.",
			});
		}

		const messagesToBranch = messages.slice(targetIndex);
		const previousMessage = targetIndex > 0 ? messages[targetIndex - 1] : null;
		const now = Date.now();
		const branchDocument = {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: chat._id,
			forkedFromMessageId: targetMessageId,
			...(previousMessage
				? { retainedThroughMessageId: previousMessage.messageId }
				: {}),
			messageCount: messagesToBranch.length,
			preview: normalizeChatPreview(messagesToBranch.at(-1)?.text),
			createdAt: now,
		};
		const branchId = await ctx.db.insert("chatBranches", branchDocument);
		const branchMessagePairs = messagesToBranch.map(
			(sourceMessage, sequence) => ({
				document: {
					branchId,
					chatId: chat._id,
					ownerTokenIdentifier,
					sequence,
					messageId: sourceMessage.messageId,
					role: sourceMessage.role,
					partsJson: sourceMessage.partsJson,
					metadataJson: sourceMessage.metadataJson,
					text: sourceMessage.text,
					createdAt: sourceMessage.createdAt,
				},
				sourceMessage,
			}),
		);
		for (const { document } of branchMessagePairs) {
			requireConvexDocumentWithinLimit({
				document,
				errorCode: "CHAT_BRANCH_MESSAGE_TOO_LARGE",
				message: "Chat branch message exceeds Convex's document limit.",
			});
		}
		await Promise.all(
			branchMessagePairs.map(async ({ document, sourceMessage }) => {
				await ctx.db.insert("chatBranchMessages", document);
				await ctx.db.delete(sourceMessage._id);
			}),
		);

		const compaction = await ctx.db
			.query("chatContextCompactions")
			.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
			.unique();
		if (compaction) {
			await ctx.db.delete(compaction._id);
		}
		const activeRunsHaveMore = await stopActiveRunsForChat(ctx, chat._id);
		if (activeRunsHaveMore) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
				message: "Chat has multiple active assistant runs.",
			});
		}
		await ctx.db.patch(chat._id, {
			preview: normalizeChatPreview(previousMessage?.text),
			updatedAt: now,
			lastMessageAt: previousMessage?.createdAt ?? chat.createdAt,
		});

		return { branchId, branchedCount: messagesToBranch.length };
	},
});
