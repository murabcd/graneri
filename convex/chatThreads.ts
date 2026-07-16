import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import { getActiveStreamForChat } from "./assistantRunStreamState";
import { syncChatMessageAttachmentReferences } from "./chatAttachmentReferences";
import { normalizeChatPreview } from "./chatFormatting";
import { clampWhitespace, createResourceAccess, truncate } from "./domain";

const { requireTokenIdentifier } = createResourceAccess("chat threads");
const MAX_FORKED_CHAT_MESSAGES = 200;
const MAX_CHAT_TITLE_LENGTH = 80;

const storedUiMessageValidator = v.object({
	id: v.string(),
	role: v.union(
		v.literal("system"),
		v.literal("user"),
		v.literal("assistant"),
	),
	partsJson: v.string(),
	metadataJson: v.optional(v.string()),
	text: v.string(),
	createdAt: v.number(),
});

export const readPage = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		paginationOpts: paginationOptsValidator,
	},
	returns: paginationResultValidator(storedUiMessageValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);
		if (!chat) {
			return { page: [], isDone: true, continueCursor: "" };
		}

		const result = await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chat._id))
			.order("desc")
			.paginate(args.paginationOpts);
		const page = result.page.map((message) => ({
			id: message.messageId,
			role: message.role,
			partsJson: message.partsJson,
			metadataJson: message.metadataJson,
			text: message.text,
			createdAt: message.createdAt,
		}));

		if (args.paginationOpts.cursor === null) {
			const stream = await getActiveStreamForChat(ctx, chat._id);
			if (
				stream &&
				(stream.text.length > 0 || stream.partsJson !== "[]") &&
				!page.some((message) => message.id === stream.assistantMessageId)
			) {
				page.unshift({
					id: stream.assistantMessageId,
					role: "assistant",
					partsJson: stream.partsJson,
					metadataJson: undefined,
					text: stream.text,
					createdAt: stream._creationTime,
				});
			}
		}

		return { ...result, page };
	},
});

export const forkFromAssistantMessage = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		messageId: v.string(),
		forkChatId: v.string(),
	},
	returns: v.object({
		chatId: v.string(),
		copiedMessageCount: v.number(),
		historyOmittedBefore: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const sourceChat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);
		if (!sourceChat) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}
		const messageId = clampWhitespace(args.messageId);
		const forkChatId = clampWhitespace(args.forkChatId);
		if (!messageId || !forkChatId || forkChatId === sourceChat.chatId) {
			throw new ConvexError({
				code: "CHAT_FORK_INVALID",
				message: "Chat fork request is invalid.",
			});
		}
		const existingForkChat = await ctx.db
			.query("chats")
			.withIndex(
				"by_ownerTokenIdentifier_and_workspaceId_and_chatId",
				(q) =>
					q
						.eq("ownerTokenIdentifier", ownerTokenIdentifier)
						.eq("workspaceId", args.workspaceId)
						.eq("chatId", forkChatId),
			)
			.unique();
		if (existingForkChat) {
			throw new ConvexError({
				code: "CHAT_FORK_CONFLICT",
				message: "Forked chat already exists.",
			});
		}

		const targetMessage = await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId_and_messageId", (q) =>
				q.eq("chatId", sourceChat._id).eq("messageId", messageId),
			)
			.unique();
		if (!targetMessage || targetMessage.role !== "assistant") {
			throw new ConvexError({
				code: "CHAT_FORK_TARGET_INVALID",
				message: "Chat can only continue from a stored assistant message.",
			});
		}

		const messagesDescending = await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId", (q) =>
				q
					.eq("chatId", sourceChat._id)
					.lte("_creationTime", targetMessage._creationTime),
			)
			.order("desc")
			.take(MAX_FORKED_CHAT_MESSAGES + 1);
		const targetIndex = messagesDescending.findIndex(
			(message) => message._id === targetMessage._id,
		);
		if (targetIndex < 0) {
			throw new ConvexError({
				code: "CHAT_FORK_TARGET_NOT_FOUND",
				message: "Chat fork target is no longer available.",
			});
		}
		const sourceMessages = messagesDescending
			.slice(targetIndex, targetIndex + MAX_FORKED_CHAT_MESSAGES)
			.reverse();
		const historyOmittedBefore =
			messagesDescending.length > targetIndex + MAX_FORKED_CHAT_MESSAGES;
		const now = Date.now();
		const sourceTitle = clampWhitespace(sourceChat.title);
		const title = truncate(
			sourceTitle && sourceTitle !== "New chat"
				? `${sourceTitle} (fork)`
				: "Forked chat",
			MAX_CHAT_TITLE_LENGTH,
		);
		const forkId = await ctx.db.insert("chats", {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			authorName: sourceChat.authorName,
			chatId: forkChatId,
			noteId: sourceChat.noteId,
			forkedFromChatId: sourceChat.chatId,
			forkedFromMessageId: targetMessage.messageId,
			historyOmittedBefore,
			isStarred: false,
			starredSortOrder: now,
			title,
			preview: normalizeChatPreview(targetMessage.text),
			model: sourceChat.model,
			reasoningEffort: sourceChat.reasoningEffort,
			isArchived: false,
			archivedAt: undefined,
			createdAt: now,
			updatedAt: now,
			lastMessageAt: targetMessage.createdAt,
		});

		for (const message of sourceMessages) {
			await ctx.db.insert("chatMessages", {
				chatId: forkId,
				ownerTokenIdentifier,
				messageId: message.messageId,
				role: message.role,
				partsJson: message.partsJson,
				metadataJson: message.metadataJson,
				text: message.text,
				createdAt: message.createdAt,
			});
			await syncChatMessageAttachmentReferences(ctx, {
				chatId: forkId,
				messageId: message.messageId,
				partsJson: message.partsJson,
			});
		}

		return {
			chatId: forkChatId,
			copiedMessageCount: sourceMessages.length,
			historyOmittedBefore,
		};
	},
});
