import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const deleteStoredAudio = internalMutation({
	args: {
		storageId: v.id("_storage"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const metadata = await ctx.db.system.get(args.storageId);
		if (metadata) {
			await ctx.storage.delete(args.storageId);
		}
		return null;
	},
});
