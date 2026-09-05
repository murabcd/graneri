import { ConvexError, type Value, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import {
	deleteQueuedMessage,
	syncQueuedMessageAttachments,
} from "./assistantQueuedMessageAttachments";
import {
	assistantQueuedMessageReplayClaimAttemptValidator,
	type ClaimedAssistantQueuedMessage,
	claimedAssistantQueuedMessageValidator,
	type QueuedMessageInput,
	queuedAssistantQueuedMessageValidator,
	queuedMessageInputValidator,
	restoreEditingMessage,
	type VisibleAssistantQueuedMessage,
	visibleAssistantQueuedMessageValidator,
} from "./assistantQueuedMessageModel";
import {
	CLAIMED_QUEUE_MESSAGE_STALE_MS,
	claimQueuedMessageForChat,
	claimQueuedMessageForRun,
	discardQueuedForRunInternal,
	getExecutableQueueHead,
	getScopedQueuedMessageForChat,
	isCurrentNonTerminalRunForChat,
	MAX_ASSISTANT_QUEUE_MESSAGES,
	releaseClaimIfCurrent,
	requireOwnedAssistantRun,
	requireSavedQueuedMessage,
	requireSingleActiveRunForChat,
	requireValidQueuedMessageInput,
	resumeInterruptedQueuedForChatInternal,
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

const currentRunAdmissionValidator = v.union(
	v.object({
		status: v.literal("queued"),
		queuedMessage: queuedAssistantQueuedMessageValidator,
	}),
	v.object({ status: v.literal("no_active") }),
);
const listVisibleQueuedMessages = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
) => {
	const messages = await Promise.all(
		(["queued", "paused"] as const).map((status) =>
			ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_chatId_and_status_and_createdAt", (q) =>
					q.eq("chatId", chatId).eq("status", status),
				)
				.take(MAX_ASSISTANT_QUEUE_MESSAGES),
		),
	);

	return messages
		.flat()
		.filter(
			(message): message is VisibleAssistantQueuedMessage =>
				message.status === "queued" || message.status === "paused",
		)
		.sort((a, b) => a.createdAt - b.createdAt)
		.slice(0, MAX_ASSISTANT_QUEUE_MESSAGES);
};

const requireQueuedMessageWithinDocumentLimit = (
	document: Record<string, Value | undefined>,
) =>
	requireConvexDocumentWithinLimit({
		document,
		errorCode: "QUEUED_MESSAGE_TOO_LARGE",
		message: "Queued message exceeds Convex's 1 MiB document limit.",
	});

const scheduleClaimRecovery = async (
	ctx: MutationCtx,
	claimedMessage: ClaimedAssistantQueuedMessage,
) => {
	await ctx.scheduler.runAfter(
		CLAIMED_QUEUE_MESSAGE_STALE_MS,
		internal.assistantQueuedMessages.releaseClaimIfStale,
		{
			queuedMessageId: claimedMessage._id,
			claimVersion: claimedMessage.claimVersion,
		},
	);
};

const insertQueuedMessage = async (
	ctx: MutationCtx,
	{
		chatId,
		message,
		ownerTokenIdentifier,
		runId,
		workspaceId,
	}: {
		chatId: Id<"chats">;
		message: QueuedMessageInput;
		ownerTokenIdentifier: string;
		runId: Id<"assistantRuns">;
		workspaceId: Id<"workspaces">;
	},
) => {
	requireValidQueuedMessageInput(message);
	const existingMessages = await ctx.db
		.query("assistantQueuedMessages")
		.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chatId))
		.take(MAX_ASSISTANT_QUEUE_MESSAGES);
	if (existingMessages.length >= MAX_ASSISTANT_QUEUE_MESSAGES) {
		throw new ConvexError({
			code: "ASSISTANT_QUEUE_FULL",
			message: "Assistant message queue is full.",
		});
	}

	const now = Date.now();
	const queuedMessageDocument = {
		ownerTokenIdentifier,
		workspaceId,
		chatId,
		runId,
		messageId: message.messageId,
		metadataJson: message.metadataJson,
		text: message.text,
		filesJson: message.filesJson,
		requestBodyJson: message.requestBodyJson,
		status: "queued",
		createdAt: now,
		updatedAt: now,
		claimVersion: 0,
	} as const;
	requireQueuedMessageWithinDocumentLimit(queuedMessageDocument);
	const queuedMessageId = await ctx.db.insert(
		"assistantQueuedMessages",
		queuedMessageDocument,
	);
	await syncQueuedMessageAttachments(ctx, queuedMessageId, message.filesJson);
	const queuedMessage = await ctx.db.get(queuedMessageId);

	if (queuedMessage?.status !== "queued") {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_SAVE_FAILED",
			message: "Failed to queue assistant message.",
		});
	}

	return queuedMessage;
};

const getContinuationReservationRunId = async (
	ctx: MutationCtx,
	{
		chatId,
		ownerTokenIdentifier,
		workspaceId,
	}: {
		chatId: Id<"chats">;
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
	},
) => {
	const reservation = await getExecutableQueueHead(ctx, chatId);
	if (!reservation) {
		return null;
	}
	if (
		reservation.ownerTokenIdentifier !== ownerTokenIdentifier ||
		reservation.workspaceId !== workspaceId
	) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
			message: "Queued continuation reservation is outside the chat scope.",
		});
	}
	return reservation.runId;
};

export const enqueueForCurrentRun = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		message: queuedMessageInputValidator,
	},
	returns: currentRunAdmissionValidator,
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

		const [activeRun] = await requireSingleActiveRunForChat(ctx, chat._id);
		if (
			activeRun &&
			(activeRun.ownerTokenIdentifier !== ownerTokenIdentifier ||
				activeRun.workspaceId !== args.workspaceId)
		) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
				message: "Active assistant run is outside the chat scope.",
			});
		}
		const reservationRunId =
			activeRun?._id ??
			(await getContinuationReservationRunId(ctx, {
				chatId: chat._id,
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
			}));
		if (!reservationRunId) {
			return { status: "no_active" } as const;
		}

		return {
			status: "queued",
			queuedMessage: await insertQueuedMessage(ctx, {
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				chatId: chat._id,
				runId: reservationRunId,
				message: args.message,
			}),
		} as const;
	},
});

export const enqueueForActiveRun = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		message: queuedMessageInputValidator,
	},
	returns: queuedAssistantQueuedMessageValidator,
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

		return await insertQueuedMessage(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: chat._id,
			runId: run._id,
			message: args.message,
		});
	},
});

export const listQueuedForChat = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.array(visibleAssistantQueuedMessageValidator),
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

		return await listVisibleQueuedMessages(ctx, chat._id);
	},
});

export const claimForSteer = mutation({
	args: {
		runId: v.id("assistantRuns"),
		queuedMessageId: v.id("assistantQueuedMessages"),
	},
	returns: claimedAssistantQueuedMessageValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const claimedMessage = await claimQueuedMessageForRun(ctx, {
			ownerTokenIdentifier,
			queuedMessageId: args.queuedMessageId,
			runId: args.runId,
		});
		await scheduleClaimRecovery(ctx, claimedMessage);
		return claimedMessage;
	},
});

export const claimForReplay = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		expectedStatus: v.union(v.literal("paused"), v.literal("queued")),
		queuedMessageId: v.id("assistantQueuedMessages"),
	},
	returns: assistantQueuedMessageReplayClaimAttemptValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const attempt = await claimQueuedMessageForChat(ctx, {
			chatId: args.chatId,
			expectedStatus: args.expectedStatus,
			ownerTokenIdentifier,
			queuedMessageId: args.queuedMessageId,
			workspaceId: args.workspaceId,
		});
		if (attempt.status === "claimed") {
			await scheduleClaimRecovery(ctx, attempt.claimedMessage);
		}
		return attempt;
	},
});

export const resumeInterruptedForChat = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
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
		if ((await requireSingleActiveRunForChat(ctx, chat._id)).length > 0) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_ACTIVE",
				message: "Queued messages cannot resume during an active run.",
			});
		}
		await resumeInterruptedQueuedForChatInternal(ctx, chat._id);
		return null;
	},
});

export const releaseClaimIfStale = internalMutation({
	args: {
		queuedMessageId: v.id("assistantQueuedMessages"),
		claimVersion: v.number(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await releaseClaimIfCurrent(ctx, args.queuedMessageId, args.claimVersion);
		return null;
	},
});

export const releaseClaimed = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageId: v.id("assistantQueuedMessages"),
		claimVersion: v.number(),
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
			return null;
		}
		const queuedMessage = await ctx.db.get(args.queuedMessageId);
		if (!queuedMessage) {
			return null;
		}
		if (
			queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
			queuedMessage.workspaceId !== args.workspaceId ||
			queuedMessage.chatId !== chat._id
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_FOUND",
				message: "Queued message is no longer available.",
			});
		}

		if (
			queuedMessage.status !== "claimed" ||
			queuedMessage.claimVersion !== args.claimVersion
		) {
			return null;
		}

		await releaseClaimIfCurrent(
			ctx,
			queuedMessage._id,
			queuedMessage.claimVersion,
		);

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

		if (
			queuedMessage.status !== "queued" &&
			queuedMessage.status !== "paused"
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_EDITABLE",
				message: "Queued message cannot be edited.",
			});
		}

		await deleteQueuedMessage(ctx, queuedMessage._id);

		return null;
	},
});

export const updateQueued = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageId: v.id("assistantQueuedMessages"),
		message: queuedMessageInputValidator,
		claimVersion: v.number(),
	},
	returns: visibleAssistantQueuedMessageValidator,
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
			queuedMessage.status !== "editing" ||
			queuedMessage.claimVersion !== args.claimVersion
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
			...restoreEditingMessage(queuedMessage),
			messageId: args.message.messageId,
			metadataJson: args.message.metadataJson,
			text: args.message.text,
			filesJson: args.message.filesJson,
			requestBodyJson: args.message.requestBodyJson,
			updatedAt: now,
		};
		requireQueuedMessageWithinDocumentLimit(updatedQueuedMessage);
		const { _creationTime, _id, ...replacement } = updatedQueuedMessage;
		await ctx.db.replace(_id, replacement);
		await syncQueuedMessageAttachments(ctx, _id, args.message.filesJson);

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
		if (args.queuedMessageIds.length > MAX_ASSISTANT_QUEUE_MESSAGES) {
			throw new ConvexError({
				code: "INVALID_QUEUED_MESSAGE_REORDER",
				message: "Queued messages cannot be reordered.",
			});
		}
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
					(queuedMessage.status !== "queued" &&
						queuedMessage.status !== "paused"),
			)
		) {
			throw new ConvexError({
				code: "INVALID_QUEUED_MESSAGE_REORDER",
				message: "Queued messages cannot be reordered.",
			});
		}

		const existingQueuedMessages = await listVisibleQueuedMessages(
			ctx,
			chat._id,
		);
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
