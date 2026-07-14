import { ConvexError, type Value, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	claimQueuedMessageForChat,
	claimQueuedMessagesForRun,
	discardQueuedForRunInternal,
	getScopedQueuedMessageForChat,
	isCurrentNonTerminalRunForChat,
	requireOwnedAssistantRun,
	requireSavedQueuedMessage,
	requireSingleActiveRunForChat,
	requireValidQueuedMessageInput,
	requireValidStoredQueuedMessage,
} from "./assistantQueuedMessageStateMachine";
import {
	getOwnedActiveChatById,
	isNonTerminalRun,
} from "./assistantRunLifecycle";
import { requireConvexDocumentWithinLimit } from "./documentSize";
import { createResourceAccess } from "./domain";

const { requireTokenIdentifier } = createResourceAccess(
	"assistantQueuedMessages",
);

const queuedMessageStatusValidator = v.union(
	v.literal("queued"),
	v.literal("claimed"),
);

const queuedMessageValidator = v.object({
	_id: v.id("assistantQueuedMessages"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	chatId: v.id("chats"),
	runId: v.id("assistantRuns"),
	messageId: v.string(),
	metadataJson: v.optional(v.string()),
	text: v.string(),
	requestBodyJson: v.string(),
	status: queuedMessageStatusValidator,
	createdAt: v.number(),
	updatedAt: v.number(),
	claimedAt: v.optional(v.number()),
});

const queuedMessageInputValidator = v.object({
	messageId: v.string(),
	metadataJson: v.optional(v.string()),
	text: v.string(),
	requestBodyJson: v.string(),
});
const queuedMessagesListLimit = 20;

const requireQueuedMessageWithinDocumentLimit = (
	document: Record<string, Value | undefined>,
) =>
	requireConvexDocumentWithinLimit({
		document,
		errorCode: "QUEUED_MESSAGE_TOO_LARGE",
		message: "Queued message exceeds Convex's 1 MiB document limit.",
	});

export const enqueueForActiveRun = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		message: queuedMessageInputValidator,
	},
	returns: queuedMessageValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}

		const run = await requireOwnedAssistantRun(
			ctx,
			ownerTokenIdentifier,
			args.runId,
		);
		if (
			run.workspaceId !== args.workspaceId ||
			run.chatId !== chat._id ||
			!isNonTerminalRun(run) ||
			!(await isCurrentNonTerminalRunForChat(ctx, run))
		) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_ACTIVE",
				message: "Assistant run is not active.",
			});
		}

		requireValidQueuedMessageInput(args.message);

		const now = Date.now();
		const queuedMessageDocument = {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: chat._id,
			runId: run._id,
			messageId: args.message.messageId,
			metadataJson: args.message.metadataJson,
			text: args.message.text,
			requestBodyJson: args.message.requestBodyJson,
			status: "queued",
			createdAt: now,
			updatedAt: now,
			claimedAt: undefined,
		} as const;
		requireQueuedMessageWithinDocumentLimit(queuedMessageDocument);
		const queuedMessageId = await ctx.db.insert(
			"assistantQueuedMessages",
			queuedMessageDocument,
		);
		const queuedMessage = await ctx.db.get(queuedMessageId);

		if (!queuedMessage) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_SAVE_FAILED",
				message: "Failed to queue assistant message.",
			});
		}

		return queuedMessage;
	},
});

export const listQueuedForChat = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.array(queuedMessageValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return [];
		}

		await requireSingleActiveRunForChat(ctx, chat._id);

		const queuedMessages = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_status_and_createdAt", (q) =>
				q.eq("chatId", chat._id).eq("status", "queued"),
			)
			.take(queuedMessagesListLimit);

		return queuedMessages
			.sort((a, b) => a.createdAt - b.createdAt)
			.slice(0, queuedMessagesListLimit);
	},
});

export const claimNextForRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
		queuedMessageId: v.optional(v.id("assistantQueuedMessages")),
	},
	returns: v.union(queuedMessageValidator, v.null()),
	handler: async (ctx, args) => {
		const isTargetedClaim = Boolean(args.queuedMessageId);
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const messages = await claimQueuedMessagesForRun(ctx, {
			includeReady: false,
			ownerTokenIdentifier,
			queuedMessageId: args.queuedMessageId,
			runId: args.runId,
			targetRequired: isTargetedClaim,
		});
		return messages[0] ?? null;
	},
});

export const claimReadyForRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
		queuedMessageId: v.id("assistantQueuedMessages"),
	},
	returns: v.array(queuedMessageValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		return await claimQueuedMessagesForRun(ctx, {
			includeReady: true,
			ownerTokenIdentifier,
			queuedMessageId: args.queuedMessageId,
			runId: args.runId,
			targetRequired: true,
		});
	},
});

export const claimNextForChat = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.union(queuedMessageValidator, v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		return await claimQueuedMessageForChat(ctx, {
			chatId: args.chatId,
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
		});
	},
});

export const getClaimedForChat = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageId: v.id("assistantQueuedMessages"),
	},
	returns: v.union(queuedMessageValidator, v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const { chat, queuedMessage } = await getScopedQueuedMessageForChat(ctx, {
			chatId: args.chatId,
			ownerTokenIdentifier,
			queuedMessageId: args.queuedMessageId,
			workspaceId: args.workspaceId,
		});
		await requireSingleActiveRunForChat(ctx, chat._id);

		if (queuedMessage.status !== "claimed") {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_CLAIMED",
				message: "Queued message is not claimed.",
			});
		}
		requireValidStoredQueuedMessage(queuedMessage);

		return queuedMessage;
	},
});

export const discardClaimed = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageId: v.id("assistantQueuedMessages"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const { queuedMessage } = await getScopedQueuedMessageForChat(ctx, {
			chatId: args.chatId,
			ownerTokenIdentifier,
			queuedMessageId: args.queuedMessageId,
			workspaceId: args.workspaceId,
		});

		if (queuedMessage.status !== "claimed") {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_CLAIMED",
				message: "Queued message is not claimed.",
			});
		}

		await ctx.db.delete(queuedMessage._id);

		return null;
	},
});

export const discardQueued = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageId: v.id("assistantQueuedMessages"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const { queuedMessage } = await getScopedQueuedMessageForChat(ctx, {
			chatId: args.chatId,
			ownerTokenIdentifier,
			queuedMessageId: args.queuedMessageId,
			workspaceId: args.workspaceId,
		});

		if (queuedMessage.status !== "queued") {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_EDITABLE",
				message: "Queued message cannot be edited.",
			});
		}

		await ctx.db.delete(queuedMessage._id);

		return null;
	},
});

export const updateQueued = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageId: v.id("assistantQueuedMessages"),
		message: queuedMessageInputValidator,
	},
	returns: queuedMessageValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const queuedMessage = await requireSavedQueuedMessage(
			ctx,
			args.queuedMessageId,
		);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (
			!chat ||
			queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
			queuedMessage.workspaceId !== args.workspaceId ||
			queuedMessage.chatId !== chat._id ||
			queuedMessage.status !== "queued"
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_EDITABLE",
				message: "Queued message cannot be edited.",
			});
		}
		await requireSingleActiveRunForChat(ctx, chat._id);

		requireValidQueuedMessageInput(args.message);

		const now = Date.now();
		const updatedQueuedMessage = {
			...queuedMessage,
			messageId: args.message.messageId,
			metadataJson: args.message.metadataJson,
			text: args.message.text,
			requestBodyJson: args.message.requestBodyJson,
			updatedAt: now,
		};
		requireQueuedMessageWithinDocumentLimit(updatedQueuedMessage);
		const { _creationTime, _id, ...replacement } = updatedQueuedMessage;
		await ctx.db.replace(_id, replacement);

		return updatedQueuedMessage;
	},
});

export const reorderQueuedForChat = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageIds: v.array(v.id("assistantQueuedMessages")),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}

		await requireSingleActiveRunForChat(ctx, chat._id);

		const uniqueQueuedMessageIds = [...new Set(args.queuedMessageIds)];
		const queuedMessages = await Promise.all(
			uniqueQueuedMessageIds.map((queuedMessageId) =>
				ctx.db.get(queuedMessageId),
			),
		);
		if (
			queuedMessages.some(
				(queuedMessage) =>
					!queuedMessage ||
					queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
					queuedMessage.workspaceId !== args.workspaceId ||
					queuedMessage.chatId !== chat._id ||
					queuedMessage.status !== "queued",
			)
		) {
			throw new ConvexError({
				code: "INVALID_QUEUED_MESSAGE_REORDER",
				message: "Queued messages cannot be reordered.",
			});
		}

		const existingQueuedMessages = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_status_and_createdAt", (q) =>
				q.eq("chatId", chat._id).eq("status", "queued"),
			)
			.take(queuedMessagesListLimit);
		if (
			existingQueuedMessages.length !== uniqueQueuedMessageIds.length ||
			existingQueuedMessages.some(
				(queuedMessage) =>
					!uniqueQueuedMessageIds.some(
						(queuedMessageId) => queuedMessageId === queuedMessage._id,
					),
			)
		) {
			throw new ConvexError({
				code: "INVALID_QUEUED_MESSAGE_REORDER",
				message: "Queued message order is stale.",
			});
		}

		const now = Date.now();
		const firstCreatedAt = Math.min(
			...existingQueuedMessages.map((queuedMessage) => queuedMessage.createdAt),
		);
		await Promise.all(
			uniqueQueuedMessageIds.map((queuedMessageId, index) =>
				ctx.db.patch(queuedMessageId, {
					createdAt: firstCreatedAt + index,
					updatedAt: now,
				}),
			),
		);

		return null;
	},
});

export const discardQueuedForRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const run = await requireOwnedAssistantRun(
			ctx,
			ownerTokenIdentifier,
			args.runId,
		);
		await discardQueuedForRunInternal(ctx, run._id);

		return null;
	},
});
