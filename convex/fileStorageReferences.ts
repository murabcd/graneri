import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const deleteFileStorageIfUnreferenced = async (
	ctx: MutationCtx,
	storageId: Id<"_storage">,
) => {
	const [chatReference, noteReference] = await Promise.all([
		ctx.db
			.query("chatAttachmentReferences")
			.withIndex("by_storageId", (query) => query.eq("storageId", storageId))
			.first(),
		ctx.db
			.query("noteAttachmentReferences")
			.withIndex("by_storageId", (query) => query.eq("storageId", storageId))
			.first(),
	]);
	if (chatReference || noteReference) {
		return;
	}

	const [metadata, artifactOutput] = await Promise.all([
		ctx.db.system.get(storageId),
		ctx.db
			.query("artifactJobOutputs")
			.withIndex("by_storageId", (query) => query.eq("storageId", storageId))
			.unique(),
	]);
	if (metadata) {
		await ctx.storage.delete(storageId);
	}
	if (artifactOutput) {
		await ctx.db.delete(artifactOutput._id);
	}
};
