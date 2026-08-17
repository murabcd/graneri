import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const deleteImageIfUnreferenced = async (
	ctx: MutationCtx,
	noteImageId: Id<"noteImages">,
) => {
	const remainingReference = await ctx.db
		.query("noteImageReferences")
		.withIndex("by_noteImageId", (query) =>
			query.eq("noteImageId", noteImageId),
		)
		.first();
	if (remainingReference) {
		return;
	}

	const image = await ctx.db.get(noteImageId);
	if (!image) {
		return;
	}

	await ctx.storage.delete(image.storageId);
	await ctx.db.delete(noteImageId);
};

export const syncNoteImageReferences = async ({
	ctx,
	note,
	revisionId,
	images,
}: {
	ctx: MutationCtx;
	note: Doc<"notes">;
	revisionId: Id<"noteRevisions"> | null;
	images: Array<{ noteImageId: string; src: string }>;
}) => {
	const imageIds = await Promise.all(
		images.map(async ({ noteImageId: rawImageId, src }) => {
			const noteImageId = await ctx.db.normalizeId("noteImages", rawImageId);
			if (!noteImageId) {
				throw new ConvexError({
					code: "INVALID_NOTE_IMAGE",
					message: "This image does not belong to the note.",
				});
			}
			const image = await ctx.db.get(noteImageId);
			if (
				!image ||
				image.ownerTokenIdentifier !== note.ownerTokenIdentifier ||
				image.workspaceId !== note.workspaceId ||
				image.noteId !== note._id
			) {
				throw new ConvexError({
					code: "INVALID_NOTE_IMAGE",
					message: "This image does not belong to the note.",
				});
			}
			const canonicalUrl = await ctx.storage.getUrl(image.storageId);
			if (!canonicalUrl || canonicalUrl !== src) {
				throw new ConvexError({
					code: "INVALID_NOTE_IMAGE",
					message: "This image does not use its Convex storage URL.",
				});
			}
			return noteImageId;
		}),
	);
	const nextImageIds = new Set(imageIds);
	const existingReferences = await ctx.db
		.query("noteImageReferences")
		.withIndex("by_noteId_and_revisionId", (query) =>
			query.eq("noteId", note._id).eq("revisionId", revisionId),
		)
		.collect();
	const existingImageIds = new Set(
		existingReferences.map((reference) => reference.noteImageId),
	);

	await Promise.all(
		imageIds.flatMap((noteImageId) =>
			existingImageIds.has(noteImageId)
				? []
				: [
						ctx.db.insert("noteImageReferences", {
							noteId: note._id,
							revisionId,
							noteImageId,
						}),
					],
		),
	);

	for (const reference of existingReferences) {
		if (nextImageIds.has(reference.noteImageId)) {
			continue;
		}
		await ctx.db.delete(reference._id);
		await deleteImageIfUnreferenced(ctx, reference.noteImageId);
	}
};

export const removeNoteImageReferences = async ({
	ctx,
	noteId,
	revisionId,
}: {
	ctx: MutationCtx;
	noteId: Id<"notes">;
	revisionId: Id<"noteRevisions"> | null;
}) => {
	const references = await ctx.db
		.query("noteImageReferences")
		.withIndex("by_noteId_and_revisionId", (query) =>
			query.eq("noteId", noteId).eq("revisionId", revisionId),
		)
		.collect();

	for (const reference of references) {
		await ctx.db.delete(reference._id);
		await deleteImageIfUnreferenced(ctx, reference.noteImageId);
	}
};

export const removeAllNoteImages = async (
	ctx: MutationCtx,
	note: Doc<"notes">,
) => {
	const [images, references] = await Promise.all([
		ctx.db
			.query("noteImages")
			.withIndex("by_ownerTokenIdentifier_and_noteId", (query) =>
				query
					.eq("ownerTokenIdentifier", note.ownerTokenIdentifier)
					.eq("noteId", note._id),
			)
			.collect(),
		ctx.db
			.query("noteImageReferences")
			.withIndex("by_noteId_and_revisionId", (query) =>
				query.eq("noteId", note._id),
			)
			.collect(),
	]);

	await Promise.all(
		references.map((reference) => ctx.db.delete(reference._id)),
	);

	for (const image of images) {
		await ctx.storage.delete(image.storageId);
		await ctx.db.delete(image._id);
	}
};

export const deletePendingNoteImage = deleteImageIfUnreferenced;
