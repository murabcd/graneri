import { ConvexError } from "convex/values";
import { z } from "zod";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const MAX_IMAGES_PER_NOTE = 50;

type NoteContentNode = {
	type: string;
	attrs?: { noteImageId?: unknown; src?: unknown };
	content?: NoteContentNode[];
};

const noteContentNodeSchema: z.ZodType<NoteContentNode> = z.lazy(() =>
	z
		.object({
			type: z.string(),
			attrs: z
				.object({
					noteImageId: z.unknown().optional(),
					src: z.unknown().optional(),
				})
				.passthrough()
				.optional(),
			content: z.array(noteContentNodeSchema).optional(),
		})
		.passthrough(),
);

const collectImageIds = (
	node: NoteContentNode,
	images: Map<string, string>,
) => {
	if (node.type === "image") {
		const noteImageId = node.attrs?.noteImageId;
		const src = node.attrs?.src;
		if (
			typeof noteImageId !== "string" ||
			!noteImageId.trim() ||
			typeof src !== "string" ||
			!src.trim()
		) {
			throw new ConvexError({
				code: "INVALID_NOTE_IMAGE",
				message: "Note images must be uploaded before they are saved.",
			});
		}
		const existingSrc = images.get(noteImageId);
		if (existingSrc && existingSrc !== src) {
			throw new ConvexError({
				code: "INVALID_NOTE_IMAGE",
				message: "A note image cannot use multiple sources.",
			});
		}
		images.set(noteImageId, src);
	}

	for (const child of node.content ?? []) {
		collectImageIds(child, images);
	}
};

export const extractNoteImages = (content: string) => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content) as unknown;
	} catch {
		return [];
	}

	const result = noteContentNodeSchema.safeParse(parsed);
	if (!result.success) {
		return [];
	}

	const images = new Map<string, string>();
	collectImageIds(result.data, images);
	if (images.size > MAX_IMAGES_PER_NOTE) {
		throw new ConvexError({
			code: "TOO_MANY_NOTE_IMAGES",
			message: `A note can contain up to ${MAX_IMAGES_PER_NOTE} images.`,
		});
	}

	return [...images].map(([noteImageId, src]) => ({ noteImageId, src }));
};

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
	content,
}: {
	ctx: MutationCtx;
	note: Doc<"notes">;
	revisionId: Id<"noteRevisions"> | null;
	content: string;
}) => {
	const rawImages = extractNoteImages(content);
	const imageIds = await Promise.all(
		rawImages.map(async ({ noteImageId: rawImageId, src }) => {
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

export const syncStoredNoteImageReferences = async ({
	ctx,
	noteId,
	content,
}: {
	ctx: MutationCtx;
	noteId: Id<"notes">;
	content: string;
}) => {
	const note = await ctx.db.get(noteId);
	if (!note) {
		throw new Error("Inserted note is unavailable.");
	}

	await syncNoteImageReferences({
		ctx,
		note,
		revisionId: null,
		content,
	});
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
