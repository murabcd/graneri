import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { queuedAssistantQueuedMessageValidator } from "./assistantQueuedMessageModel";
import {
	getExecutableQueueHead,
	requireSingleActiveRunForChat,
} from "./assistantQueuedMessageStateMachine";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import { createResourceAccess, requireOwnedWorkspace } from "./domain";

const { requireTokenIdentifier } = createResourceAccess(
	"assistantQueuedMessageDispatch",
);

export const listChats = query({
	args: {
		workspaceId: v.id("workspaces"),
		paginationOpts: paginationOptsValidator,
	},
	returns: paginationResultValidator(v.string()),
	handler: async (ctx, args) => {
		const owner = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, owner, args.workspaceId);
		const result = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId", (q) =>
				q.eq("ownerTokenIdentifier", owner).eq("workspaceId", args.workspaceId),
			)
			.paginate({
				...args.paginationOpts,
				numItems: Math.min(args.paginationOpts.numItems, 100),
				maximumBytesRead: 2 * 1024 * 1024,
			});
		const chats = await Promise.all(
			[...new Set(result.page.map((row) => row.chatId))].map((id) =>
				ctx.db.get(id),
			),
		);
		return {
			...result,
			page: chats.flatMap((chat) =>
				chat &&
				!chat.isArchived &&
				chat.ownerTokenIdentifier === owner &&
				chat.workspaceId === args.workspaceId
					? [chat.chatId]
					: [],
			),
		};
	},
});

export const getHead = query({
	args: { workspaceId: v.id("workspaces"), chatId: v.string() },
	returns: v.union(queuedAssistantQueuedMessageValidator, v.null()),
	handler: async (ctx, args) => {
		const owner = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			owner,
			args.workspaceId,
			args.chatId,
		);
		if (
			!chat ||
			(await requireSingleActiveRunForChat(ctx, chat._id)).length > 0
		)
			return null;
		const head = await getExecutableQueueHead(ctx, chat._id);
		return head?.status === "queued" ? head : null;
	},
});
