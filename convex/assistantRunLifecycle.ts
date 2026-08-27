import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireOwnedWorkspace } from "./domain";

export const nonTerminalRunStatuses = [
	"running",
	"waiting_for_user",
	"stopping",
] as const;

export const isNonTerminalRun = (run: Doc<"assistantRuns">) =>
	nonTerminalRunStatuses.some((status) => status === run.status);

export const getOwnedActiveChatById = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
) => {
	await requireOwnedWorkspace(ctx, ownerTokenIdentifier, workspaceId);
	const chat = await ctx.db
		.query("chats")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("chatId", chatId.trim()),
		)
		.unique();

	if (!chat || chat.isArchived) {
		return null;
	}

	return chat;
};

export const requireOwnedActiveChatAndRun = async (
	ctx: MutationCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		chatId: string;
		runId: Id<"assistantRuns">;
		runNotFoundMessage?: string;
	},
): Promise<{
	chat: Doc<"chats">;
	run: Doc<"assistantRuns">;
}> => {
	const chat = await getOwnedActiveChatById(
		ctx,
		args.ownerTokenIdentifier,
		args.workspaceId,
		args.chatId,
	);

	if (!chat) {
		throw new ConvexError({
			code: "CHAT_NOT_FOUND",
			message: "Chat not found.",
		});
	}

	const run = await ctx.db.get(args.runId);
	if (
		!run ||
		run.ownerTokenIdentifier !== args.ownerTokenIdentifier ||
		run.workspaceId !== args.workspaceId ||
		run.chatId !== chat._id
	) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_NOT_FOUND",
			message: args.runNotFoundMessage ?? "Assistant run not found.",
		});
	}

	return { chat, run };
};

export const getNonTerminalRunsForChat = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
) => {
	const runs: Doc<"assistantRuns">[] = [];

	for (const status of nonTerminalRunStatuses) {
		for await (const run of ctx.db
			.query("assistantRuns")
			.withIndex("by_chatId_and_status", (q) =>
				q.eq("chatId", chatId).eq("status", status),
			)) {
			runs.push(run);
		}
	}

	return runs.sort(
		(left, right) =>
			right.startedAt - left.startedAt ||
			right._creationTime - left._creationTime,
	);
};

export const requireSingleNonTerminalRun = (runs: Doc<"assistantRuns">[]) => {
	if (runs.length <= 1) {
		return runs[0] ?? null;
	}

	throw new ConvexError({
		code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
		message: "Chat has multiple active assistant runs.",
	});
};
