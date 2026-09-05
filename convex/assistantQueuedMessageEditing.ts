import { captureQueuedMessagePosition } from "@workspace/ai/queued-message-position";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	projectQueuedMessageEdit,
	visibleAssistantQueuedMessageValidator,
} from "./assistantQueuedMessageModel";
import {
	cancelQueuedMessageEdit,
	listOrderedQueuedMessages,
} from "./assistantQueuedMessageOrder";
import {
	getScopedQueuedMessageForChat,
	queuedMessageDocumentBase,
	requireSingleActiveRunForChat,
} from "./assistantQueuedMessageStateMachine";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import { createResourceAccess } from "./domain";

const { requireTokenIdentifier } = createResourceAccess(
	"assistantQueuedMessageEditing",
);
const scopeArgs = { workspaceId: v.id("workspaces"), chatId: v.string() };

export const get = query({
	args: scopeArgs,
	returns: v.union(visibleAssistantQueuedMessageValidator, v.null()),
	handler: async (ctx, args) => {
		const owner = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			owner,
			args.workspaceId,
			args.chatId,
		);
		if (!chat) return null;
		const draft = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_status", (q) =>
				q.eq("chatId", chat._id).eq("status", "editing"),
			)
			.unique();
		return draft?.status === "editing" ? projectQueuedMessageEdit(draft) : null;
	},
});

export const begin = mutation({
	args: { ...scopeArgs, queuedMessageId: v.id("assistantQueuedMessages") },
	returns: visibleAssistantQueuedMessageValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const { chat, queuedMessage } = await getScopedQueuedMessageForChat(ctx, {
			...args,
			ownerTokenIdentifier,
		});
		await requireSingleActiveRunForChat(ctx, chat._id);
		if (
			queuedMessage.status !== "queued" &&
			queuedMessage.status !== "paused"
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_EDITABLE",
				message: "Queued message cannot be edited.",
			});
		}
		const previous = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_status", (q) =>
				q.eq("chatId", chat._id).eq("status", "editing"),
			)
			.unique();
		if (previous?.status === "editing") {
			await cancelQueuedMessageEdit(ctx, previous);
		}
		const ordered = await listOrderedQueuedMessages(ctx, chat._id);
		const current = ordered.find(
			(message) => message._id === queuedMessage._id,
		);
		if (
			!current ||
			(current.status !== "queued" && current.status !== "paused")
		)
			throw new Error("Queued edit target is missing.");
		const editPosition = captureQueuedMessagePosition(
			ordered.map((message) => message._id),
			current._id,
		);
		const updatedAt = Date.now();
		const claimVersion = queuedMessage.claimVersion + 1;
		await ctx.db.replace(queuedMessage._id, {
			...queuedMessageDocumentBase(current),
			status: "editing",
			editPosition,
			editOrigin:
				queuedMessage.status === "queued"
					? { status: "queued" }
					: { status: "paused", pauseReason: queuedMessage.pauseReason },
			claimVersion,
			updatedAt,
		});
		return { ...current, claimVersion, updatedAt };
	},
});

export const cancel = mutation({
	args: {
		...scopeArgs,
		queuedMessageId: v.id("assistantQueuedMessages"),
		claimVersion: v.number(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const { queuedMessage } = await getScopedQueuedMessageForChat(ctx, {
			...args,
			ownerTokenIdentifier,
		});
		if (
			queuedMessage.status !== "editing" ||
			queuedMessage.claimVersion !== args.claimVersion
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_EDITABLE",
				message: "Queued message cannot be edited.",
			});
		}
		await cancelQueuedMessageEdit(ctx, queuedMessage);
		return null;
	},
});
