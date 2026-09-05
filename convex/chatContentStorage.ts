import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import {
	deleteChatPayload,
	readChatPayload,
	writeChatPayload,
} from "./chatPayloads";

export const requireChatContent = async (
	ctx: QueryCtx | MutationCtx,
	id: Id<"chatContents">,
) => {
	const content = await ctx.db.get(id);
	if (!content) throw new Error("Saved chat content is missing.");
	return content;
};

export const readChatContent = async (
	ctx: QueryCtx | MutationCtx,
	id: Id<"chatContents">,
) => {
	const content = await requireChatContent(ctx, id);
	return await readChatPayload(ctx, content.payload);
};

export const retainChatContent = async (
	ctx: MutationCtx,
	id: Id<"chatContents">,
) => {
	const content = await requireChatContent(ctx, id);
	await ctx.db.patch(id, { referenceCount: content.referenceCount + 1 });
};

export const releaseChatContent = async (
	ctx: MutationCtx,
	id: Id<"chatContents">,
) => {
	const content = await requireChatContent(ctx, id);
	if (content.referenceCount < 1)
		throw new Error("Message content ownership is already released.");
	if (content.referenceCount > 1) {
		await ctx.db.patch(id, { referenceCount: content.referenceCount - 1 });
	} else {
		await ctx.db.patch(id, { referenceCount: 0 });
		await ctx.scheduler.runAfter(
			0,
			internal.chatContentStorage.deleteUnreferenced,
			{ contentId: id },
		);
	}
};

/** One bounded payload per transaction keeps bulk history removal inexpensive. */
export const deleteUnreferenced = internalMutation({
	args: { contentId: v.id("chatContents") },
	returns: v.null(),
	handler: async (ctx, { contentId }) => {
		const content = await ctx.db.get(contentId);
		if (content?.referenceCount !== 0) return null;
		await deleteChatPayload(ctx, content.payload);
		await ctx.db.delete(contentId);
		return null;
	},
});

/** Parent updates and content ownership changes must share the same mutation. */
export const writeChatContent = async (
	ctx: MutationCtx,
	serialized: string,
	previousId?: Id<"chatContents">,
) => {
	const previous = previousId
		? await requireChatContent(ctx, previousId)
		: null;
	if (previous?.referenceCount === 1) {
		const payload = await writeChatPayload(
			ctx,
			previous.payload.key,
			serialized,
		);
		await ctx.db.patch(previous._id, { payload });
		return previous._id;
	}
	const payload = await writeChatPayload(ctx, crypto.randomUUID(), serialized);
	const id = await ctx.db.insert("chatContents", {
		payload,
		referenceCount: 1,
	});
	if (previous) await releaseChatContent(ctx, previous._id);
	return id;
};
