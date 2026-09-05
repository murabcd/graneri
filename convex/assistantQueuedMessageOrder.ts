import { resolveQueuedMessagePosition } from "@workspace/ai/queued-message-position";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { projectQueuedMessageEdit } from "./assistantQueuedMessageModel";
import { MAX_ASSISTANT_QUEUE_MESSAGES } from "./assistantQueuedMessageStateMachine";

type EditingQueuedMessage = Extract<
	Doc<"assistantQueuedMessages">,
	{ status: "editing" }
>;

export const listOrderedQueuedMessages = (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
) =>
	ctx.db
		.query("assistantQueuedMessages")
		.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chatId))
		.take(MAX_ASSISTANT_QUEUE_MESSAGES);

export const writeQueuedMessageOrder = async (
	ctx: MutationCtx,
	messages: readonly Pick<
		Doc<"assistantQueuedMessages">,
		"_id" | "createdAt"
	>[],
) => {
	const now = Date.now();
	const firstCreatedAt = Math.min(
		now,
		...messages.map((message) => message.createdAt),
	);
	await Promise.all(
		messages.map((message, index) =>
			message.createdAt === firstCreatedAt + index
				? undefined
				: ctx.db.patch(message._id, {
						createdAt: firstCreatedAt + index,
						updatedAt: now,
					}),
		),
	);
	return firstCreatedAt;
};

export const restoreQueuedMessagePosition = async (
	ctx: MutationCtx,
	message: EditingQueuedMessage,
	action: "save" | "cancel",
) => {
	const others = (await listOrderedQueuedMessages(ctx, message.chatId)).filter(
		(row) => row.status !== "editing",
	);
	const index = resolveQueuedMessagePosition(
		others.map((row) => row._id),
		{
			...message.editPosition,
			index: action === "save" ? others.length : message.editPosition.index,
		},
	);
	others.splice(index, 0, projectQueuedMessageEdit(message));
	return (await writeQueuedMessageOrder(ctx, others)) + index;
};

export const cancelQueuedMessageEdit = async (
	ctx: MutationCtx,
	message: EditingQueuedMessage,
) => {
	const createdAt = await restoreQueuedMessagePosition(ctx, message, "cancel");
	const { _id, _creationTime, ...restored } = projectQueuedMessageEdit(message);
	await ctx.db.replace(_id, { ...restored, createdAt, updatedAt: Date.now() });
};
