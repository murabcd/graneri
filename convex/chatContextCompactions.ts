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

type CompactionState = Pick<
	Doc<"chatContextCompactions">,
	"summary" | "throughCreationTime" | "throughMessageId" | "updatedAt"
>;

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
	compaction: CompactionState | null,
) => {
	const messages = await ctx.db
		.query("chatMessages")
		.withIndex("by_chatId", (q) => {
			const chatMessages = q.eq("chatId", chatId);
			return compaction
				? chatMessages.gt("_creationTime", compaction.throughCreationTime)
				: chatMessages;
		})
		.order("asc")
		.take(HOSTED_CHAT_CONTEXT_MESSAGE_LIMIT + 1);

	return {
		compaction: compaction
			? {
					summary: compaction.summary,
					throughCreationTime: compaction.throughCreationTime,
					throughMessageId: compaction.throughMessageId,
					updatedAt: compaction.updatedAt,
				}
			: null,
		hasMoreMessages: messages.length > HOSTED_CHAT_CONTEXT_MESSAGE_LIMIT,
		messages: messages.map(toContextMessage),
	};
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

		const compaction = await ctx.db
			.query("chatContextCompactions")
			.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
			.unique();
		return await readPreparationState(ctx, chat._id, compaction);
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

		const activity = await ctx.db
			.query("chatContextCompactionActivities")
			.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
			.unique();

		return activity
			? {
					anchorMessageId: activity.anchorMessageId,
					status: activity.status,
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
		const existing = await ctx.db
			.query("chatContextCompactionActivities")
			.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
			.unique();
		const now = Date.now();
		if (
			existing?.status === "running" &&
			now - existing.updatedAt < CONTEXT_COMPACTION_ACTIVITY_TIMEOUT_MS
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
			activityId: args.activityId,
			anchorMessageId: args.anchorMessageId,
			status: "running" as const,
			startedAt: now,
			updatedAt: now,
		};
		let activityDocumentId: Id<"chatContextCompactionActivities">;
		if (existing) {
			await ctx.db.replace(existing._id, document);
			activityDocumentId = existing._id;
		} else {
			activityDocumentId = await ctx.db.insert(
				"chatContextCompactionActivities",
				document,
			);
		}
		await ctx.scheduler.runAfter(
			CONTEXT_COMPACTION_ACTIVITY_TIMEOUT_MS,
			internal.chatContextCompactions.expireActivity,
			{
				activityDocumentId,
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
		const activity = await ctx.db
			.query("chatContextCompactionActivities")
			.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
			.unique();
		if (
			activity?.activityId === args.activityId &&
			activity.status === "running"
		) {
			await ctx.db.delete(activity._id);
		}
		return null;
	},
});

export const expireActivity = internalMutation({
	args: {
		activityDocumentId: v.id("chatContextCompactionActivities"),
		activityId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const activity = await ctx.db.get(args.activityDocumentId);
		if (
			activity?.activityId !== args.activityId ||
			activity.status !== "running"
		) {
			return null;
		}
		const remainingLifetime =
			activity.updatedAt + CONTEXT_COMPACTION_ACTIVITY_TIMEOUT_MS - Date.now();
		if (remainingLifetime > 0) {
			await ctx.scheduler.runAfter(
				remainingLifetime,
				internal.chatContextCompactions.expireActivity,
				args,
			);
		} else {
			await ctx.db.delete(activity._id);
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
		const { chat, ownerTokenIdentifier } = await getOwnedContextChat(ctx, args);
		if (!chat) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}
		const [existing, activity] = await Promise.all([
			ctx.db
				.query("chatContextCompactions")
				.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
				.unique(),
			ctx.db
				.query("chatContextCompactionActivities")
				.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
				.unique(),
		]);
		if (
			activity?.activityId !== args.activityId ||
			activity.status !== "running"
		) {
			throw new ConvexError({
				code: "CONTEXT_COMPACTION_ACTIVITY_STALE",
				message: "Chat context compaction activity changed during preparation.",
			});
		}
		if (
			existing?.throughCreationTime !== args.expectedThroughCreationTime ||
			existing?.throughMessageId !== args.expectedThroughMessageId
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
				return existing
					? chatMessages.gt("_creationTime", existing.throughCreationTime)
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
		const document = {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: chat._id,
			summary: args.summary,
			throughCreationTime: args.throughCreationTime,
			throughMessageId: args.throughMessageId,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		requireConvexDocumentWithinLimit({
			document: existing
				? {
						...document,
						_id: existing._id,
						_creationTime: existing._creationTime,
					}
				: document,
			errorCode: "CONTEXT_COMPACTION_TOO_LARGE",
			message: "Chat context compaction exceeds Convex's document limit.",
		});
		if (existing) {
			await ctx.db.replace(existing._id, document);
		} else {
			await ctx.db.insert("chatContextCompactions", document);
		}
		const nextState = await readPreparationState(ctx, chat._id, document);
		if (nextState.hasMoreMessages) {
			await ctx.db.patch(activity._id, { updatedAt: now });
		} else {
			await ctx.db.replace(activity._id, {
				ownerTokenIdentifier: activity.ownerTokenIdentifier,
				workspaceId: activity.workspaceId,
				chatId: activity.chatId,
				activityId: activity.activityId,
				anchorMessageId: activity.anchorMessageId,
				status: "completed",
				startedAt: activity.startedAt,
				completedAt: now,
				updatedAt: now,
			});
		}
		return nextState;
	},
});
