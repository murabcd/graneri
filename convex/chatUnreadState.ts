import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const markUnreadAssistantCompletion = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	completedAt: number,
) => {
	const chat = await ctx.db.get(run.chatId);
	if (!chat || chat.isArchived) {
		return;
	}

	await ctx.db.patch(chat._id, {
		unreadAssistantCompletedAt: completedAt,
	});
};

export const clearUnreadAssistantCompletion = async (
	ctx: MutationCtx,
	chat: Doc<"chats">,
) => {
	if (chat.unreadAssistantCompletedAt === undefined) {
		return;
	}

	await ctx.db.patch(chat._id, {
		unreadAssistantCompletedAt: undefined,
	});
};
