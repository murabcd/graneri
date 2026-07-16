import {
	HOSTED_CHAT_CONTEXT_COMPACTION_BATCH_SIZE,
	HOSTED_CHAT_CONTEXT_MESSAGE_LIMIT,
	type HostedChatContextMessage,
} from "@workspace/ai/chat-context-contract";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import { requireConvexDocumentWithinLimit } from "./documentSize";
import { createResourceAccess } from "./domain";

const { requireTokenIdentifier } = createResourceAccess(
	"chatContextCompactions",
);

const contextMessageValidator = v.object({
	id: v.string(),
	role: v.union(v.literal("system"), v.literal("user"), v.literal("assistant")),
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

const compactionDisplayStateValidator = v.object({
	throughMessageId: v.string(),
});

const toContextMessage = (message: {
	messageId: string;
	role: "system" | "user" | "assistant";
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

export const getPreparationState = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.object({
		compaction: v.union(compactionValidator, v.null()),
		hasMoreMessages: v.boolean(),
		messages: v.array(contextMessageValidator),
	}),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);
		if (!chat) {
			return { compaction: null, hasMoreMessages: false, messages: [] };
		}

		const compaction = await ctx.db
			.query("chatContextCompactions")
			.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
			.unique();
		const messages = await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId", (q) => {
				const chatMessages = q.eq("chatId", chat._id);
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
	},
});

export const getDisplayState = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.union(compactionDisplayStateValidator, v.null()),
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

		const compaction = await ctx.db
			.query("chatContextCompactions")
			.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
			.unique();

		return compaction
			? { throughMessageId: compaction.throughMessageId }
			: null;
	},
});

export const save = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		expectedThroughCreationTime: v.optional(v.number()),
		expectedThroughMessageId: v.optional(v.string()),
		summary: v.string(),
		throughCreationTime: v.number(),
		throughMessageId: v.string(),
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
		const existing = await ctx.db
			.query("chatContextCompactions")
			.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
			.unique();
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
		return null;
	},
});
