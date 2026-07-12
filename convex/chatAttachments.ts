import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { createResourceAccess } from "./domain";

const { requireIdentity } = createResourceAccess("chat attachments");

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
