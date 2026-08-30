import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalQuery, mutation } from "./_generated/server";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import { createResourceAccess } from "./domain";

const { requireIdentity, requireTokenIdentifier } =
	createResourceAccess("chat attachments");

const getOwnedStorageUrl = async (
	ctx: MutationCtx | QueryCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		chatId: string;
		storageId: Id<"_storage">;
	},
) => {
	const chat = await getOwnedActiveChatById(
		ctx,
		args.ownerTokenIdentifier,
		args.workspaceId,
		args.chatId,
	);
	if (!chat) {
		return null;
	}
	const reference = await ctx.db
		.query("chatAttachmentReferences")
		.withIndex("by_storageId", (query) => query.eq("storageId", args.storageId))
		.filter((query) => query.eq(query.field("chatId"), chat._id))
		.first();
	return reference ? await ctx.storage.getUrl(args.storageId) : null;
};

export const generateUploadUrl = mutation({
	args: {},
	returns: v.string(),
	handler: async (ctx) => {
		await requireIdentity(ctx);
		return await ctx.storage.generateUploadUrl();
	},
});

export const getUrl = mutation({
	args: {
		storageId: v.id("_storage"),
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		await requireIdentity(ctx);
		return await ctx.storage.getUrl(args.storageId);
	},
});

export const getOwnedUrl = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		storageId: v.id("_storage"),
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		return await getOwnedStorageUrl(ctx, {
			...args,
			ownerTokenIdentifier: await requireTokenIdentifier(ctx),
		});
	},
});

export const getOwnedUrlInternal = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		storageId: v.string(),
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		const storageId = ctx.db.system.normalizeId("_storage", args.storageId);
		return storageId
			? await getOwnedStorageUrl(ctx, { ...args, storageId })
			: null;
	},
});
