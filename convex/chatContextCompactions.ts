import {
	HOSTED_CHAT_CONTEXT_COMPACTION_BATCH_SIZE,
	HOSTED_CHAT_CONTEXT_MESSAGE_LIMIT,
	type HostedChatContextMessage,
} from "@workspace/ai/chat-context-contract";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import { requireConvexDocumentWithinLimit } from "./documentSize";
import { createResourceAccess } from "./domain";

const CONTEXT_COMPACTION_ACTIVITY_TIMEOUT_MS = 10 * 60 * 1_000;

const { requireTokenIdentifier } = createResourceAccess(
	"chatContextCompactions",
);

const contextMessageValidator = v.object({
	id: v.string(),
	role: v.union(v.literal("user"), v.literal("assistant")),
	partsJson: v.string(),
	metadataJson: v.optional(v.string()),
	createdAt: v.number(),
	creationTime: v.number(),
});

const compactionValidator = v.object({
	summary: v.string(),
	throughCreationTime: v.number(),
	throughMessageId: v.string(),
	updatedAt: v.number(),
});

const compactionActivityValidator = v.object({
	anchorMessageId: v.string(),
	status: v.union(v.literal("running"), v.literal("completed")),
});

const preparationStateValidator = v.object({
	compaction: v.union(compactionValidator, v.null()),
	hasMoreMessages: v.boolean(),
	messages: v.array(contextMessageValidator),
});

type ChatContextState = Doc<"chatContextStates">;
type ChatContextCheckpoint = NonNullable<ChatContextState["checkpoint"]>;

const toContextMessage = (message: {
	messageId: string;
	role: HostedChatContextMessage["role"];
	partsJson: string;
	metadataJson?: string;
	createdAt: number;
	_creationTime: number;
}): HostedChatContextMessage => ({
	id: message.messageId,
	role: message.role,
	partsJson: message.partsJson,
	metadataJson: message.metadataJson,
	createdAt: message.createdAt,
	creationTime: message._creationTime,
});

const getChatContextState = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
) =>
	await ctx.db
		.query("chatContextStates")
		.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
		.unique();

export const getChatContextCheckpoint = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
): Promise<ChatContextCheckpoint | null> => {
	const state = await getChatContextState(ctx, chatId);
	return state?.checkpoint ?? null;
};

export const clearChatContextState = async (
	ctx: MutationCtx,
	chatId: Id<"chats">,
) => {
	const state = await getChatContextState(ctx, chatId);
	if (state) {
		await ctx.db.delete(state._id);
	}
};

const getOwnedContextChat = async (
	ctx: QueryCtx | MutationCtx,
	args: { workspaceId: Id<"workspaces">; chatId: string },
) => {
	const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
	const chat = await getOwnedActiveChatById(
		ctx,
		ownerTokenIdentifier,
		args.workspaceId,
		args.chatId,
	);
	return { chat, ownerTokenIdentifier };
};

const readPreparationState = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
	checkpoint: ChatContextCheckpoint | null,
) => {
	const messages = await ctx.db
		.query("chatMessages")
		.withIndex("by_chatId", (q) => {
			const chatMessages = q.eq("chatId", chatId);
			return checkpoint
				? chatMessages.gt("_creationTime", checkpoint.throughCreationTime)
				: chatMessages;
		})
		.order("asc")
		.take(HOSTED_CHAT_CONTEXT_MESSAGE_LIMIT + 1);

	return {
		compaction: checkpoint,
		hasMoreMessages: messages.length > HOSTED_CHAT_CONTEXT_MESSAGE_LIMIT,
		messages: messages.map(toContextMessage),
	};
};

const removeRunningActivity = async (
	ctx: MutationCtx,
	state: Extract<ChatContextState, { kind: "running" }>,
) => {
	if (!state.checkpoint) {
		await ctx.db.delete(state._id);
		return;
	}
	await ctx.db.replace(state._id, {
		ownerTokenIdentifier: state.ownerTokenIdentifier,
		workspaceId: state.workspaceId,
		chatId: state.chatId,
		kind: "checkpoint",
		checkpoint: state.checkpoint,
		createdAt: state.createdAt,
		updatedAt: Date.now(),
	});
};

export const getPreparationState = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: preparationStateValidator,
	handler: async (ctx, args) => {
		const { chat } = await getOwnedContextChat(ctx, args);
		if (!chat) {
			return { compaction: null, hasMoreMessages: false, messages: [] };
		}

		const checkpoint = await getChatContextCheckpoint(ctx, chat._id);
		return await readPreparationState(ctx, chat._id, checkpoint);
	},
});

export const getActivity = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.union(compactionActivityValidator, v.null()),
	handler: async (ctx, args) => {
		const { chat } = await getOwnedContextChat(ctx, args);
		if (!chat) {
			return null;
		}

		const state = await getChatContextState(ctx, chat._id);
		return state?.kind === "running" || state?.kind === "completed"
			? {
					anchorMessageId: state.anchorMessageId,
					status: state.kind,
				}
			: null;
	},
});

export const startActivity = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		activityId: v.string(),
		anchorMessageId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { chat, ownerTokenIdentifier } = await getOwnedContextChat(ctx, args);
		if (!chat) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}
		const state = await getChatContextState(ctx, chat._id);
		const now = Date.now();
		if (
			state?.kind === "running" &&
			now - state.updatedAt < CONTEXT_COMPACTION_ACTIVITY_TIMEOUT_MS
		) {
			throw new ConvexError({
				code: "CONTEXT_COMPACTION_IN_PROGRESS",
				message: "Chat context compaction is already in progress.",
			});
		}
		const document = {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: chat._id,
			kind: "running" as const,
			...(state?.checkpoint ? { checkpoint: state.checkpoint } : {}),
			activityId: args.activityId,
			anchorMessageId: args.anchorMessageId,
			startedAt: now,
			createdAt: state?.createdAt ?? now,
			updatedAt: now,
		};
		let stateDocumentId: Id<"chatContextStates">;
		if (state) {
			await ctx.db.replace(state._id, document);
			stateDocumentId = state._id;
		} else {
			stateDocumentId = await ctx.db.insert("chatContextStates", document);
		}
		await ctx.scheduler.runAfter(
			CONTEXT_COMPACTION_ACTIVITY_TIMEOUT_MS,
			internal.chatContextCompactions.expireActivity,
			{
				stateDocumentId,
				activityId: args.activityId,
			},
		);
		return null;
	},
});

export const cancelActivity = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		activityId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { chat } = await getOwnedContextChat(ctx, args);
		if (!chat) {
			return null;
		}
		const state = await getChatContextState(ctx, chat._id);
		if (state?.kind === "running" && state.activityId === args.activityId) {
			await removeRunningActivity(ctx, state);
		}
		return null;
	},
});

export const expireActivity = internalMutation({
	args: {
		stateDocumentId: v.id("chatContextStates"),
		activityId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const state = await ctx.db.get(args.stateDocumentId);
		if (state?.kind !== "running" || state.activityId !== args.activityId) {
			return null;
		}
		const remainingLifetime =
			state.updatedAt + CONTEXT_COMPACTION_ACTIVITY_TIMEOUT_MS - Date.now();
		if (remainingLifetime > 0) {
			await ctx.scheduler.runAfter(
				remainingLifetime,
				internal.chatContextCompactions.expireActivity,
				args,
			);
		} else {
			await removeRunningActivity(ctx, state);
		}
		return null;
	},
});

export const save = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		activityId: v.string(),
		expectedThroughCreationTime: v.optional(v.number()),
		expectedThroughMessageId: v.optional(v.string()),
		summary: v.string(),
		throughCreationTime: v.number(),
		throughMessageId: v.string(),
	},
	returns: preparationStateValidator,
	handler: async (ctx, args) => {
		const { chat } = await getOwnedContextChat(ctx, args);
		if (!chat) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}
		const state = await getChatContextState(ctx, chat._id);
		if (state?.kind !== "running" || state.activityId !== args.activityId) {
			throw new ConvexError({
				code: "CONTEXT_COMPACTION_ACTIVITY_STALE",
				message: "Chat context compaction activity changed during preparation.",
			});
		}
		const checkpoint = state.checkpoint;
		if (
			checkpoint?.throughCreationTime !== args.expectedThroughCreationTime ||
			checkpoint?.throughMessageId !== args.expectedThroughMessageId
		) {
			throw new ConvexError({
				code: "CONTEXT_COMPACTION_STALE",
				message: "Chat context compaction changed during preparation.",
			});
		}
		const boundaryCandidates = await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId", (q) => {
				const chatMessages = q.eq("chatId", chat._id);
				return checkpoint
					? chatMessages.gt("_creationTime", checkpoint.throughCreationTime)
					: chatMessages;
			})
			.order("asc")
			.take(HOSTED_CHAT_CONTEXT_COMPACTION_BATCH_SIZE);
		const boundary = boundaryCandidates.at(-1);
		if (
			boundaryCandidates.length !== HOSTED_CHAT_CONTEXT_COMPACTION_BATCH_SIZE ||
			!boundary ||
			boundary.messageId !== args.throughMessageId ||
			boundary._creationTime !== args.throughCreationTime
		) {
			throw new ConvexError({
				code: "CONTEXT_COMPACTION_INVALID",
				message: "Chat context compaction boundary is invalid.",
			});
		}
		const now = Date.now();
		const nextCheckpoint = {
			summary: args.summary,
			throughCreationTime: args.throughCreationTime,
			throughMessageId: args.throughMessageId,
			updatedAt: now,
		};
		const nextPreparationState = await readPreparationState(
			ctx,
			chat._id,
			nextCheckpoint,
		);
		const activeStateDocument = {
			ownerTokenIdentifier: state.ownerTokenIdentifier,
			workspaceId: state.workspaceId,
			chatId: state.chatId,
			checkpoint: nextCheckpoint,
			activityId: state.activityId,
			anchorMessageId: state.anchorMessageId,
			startedAt: state.startedAt,
			createdAt: state.createdAt,
			updatedAt: now,
		};
		const document = nextPreparationState.hasMoreMessages
			? {
					...activeStateDocument,
					kind: "running" as const,
				}
			: {
					...activeStateDocument,
					kind: "completed" as const,
					completedAt: now,
				};
		requireConvexDocumentWithinLimit({
			document: {
				...document,
				_id: state._id,
				_creationTime: state._creationTime,
			},
			errorCode: "CONTEXT_COMPACTION_TOO_LARGE",
			message: "Chat context compaction exceeds Convex's document limit.",
		});
		await ctx.db.replace(state._id, document);
		return nextPreparationState;
	},
});
