import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { requireOwnedWorkspace } from "./domain";
import { deletePendingNoteImage } from "./noteImageReferences";
import { ensureOwnedNote } from "./notes";

const MAX_STORED_IMAGES_PER_NOTE = 100;
const PENDING_NOTE_IMAGE_EXPIRATION_MS = 60 * 60 * 1000;

export const registerUploadedImage = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.string(),
		noteId: v.string(),
		storageId: v.id("_storage"),
		fileName: v.string(),
		contentType: v.string(),
		size: v.number(),
	},
	returns: v.object({
		noteImageId: v.id("noteImages"),
		url: v.string(),
	}),
	handler: async (ctx, args) => {
		const workspaceId = await ctx.db.normalizeId(
			"workspaces",
			args.workspaceId,
		);
		const noteId = await ctx.db.normalizeId("notes", args.noteId);
		if (!workspaceId || !noteId) {
			throw new ConvexError({
				code: "NOTE_NOT_FOUND",
				message: "Note not found.",
			});
		}
		await requireOwnedWorkspace(ctx, args.ownerTokenIdentifier, workspaceId);
		const note = ensureOwnedNote({
			note: await ctx.db.get(noteId),
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId,
		});
		if (note.isArchived) {
			throw new ConvexError({
				code: "NOTE_NOT_FOUND",
				message: "Note not found.",
			});
		}

		const existingImages = await ctx.db
			.query("noteImages")
			.withIndex("by_ownerTokenIdentifier_and_noteId", (query) =>
				query
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("noteId", noteId),
			)
			.take(MAX_STORED_IMAGES_PER_NOTE);
		if (existingImages.length >= MAX_STORED_IMAGES_PER_NOTE) {
			throw new ConvexError({
				code: "TOO_MANY_NOTE_IMAGES",
				message: "Remove an image before uploading another one.",
			});
		}

		const url = await ctx.storage.getUrl(args.storageId);
		if (!url) {
			throw new ConvexError({
				code: "IMAGE_UPLOAD_FAILED",
				message: "Uploaded image is unavailable.",
			});
		}
		const noteImageId = await ctx.db.insert("noteImages", {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId,
			noteId,
			storageId: args.storageId,
			fileName: args.fileName,
			contentType: args.contentType,
			size: args.size,
			createdAt: Date.now(),
		});
		await ctx.scheduler.runAfter(
			PENDING_NOTE_IMAGE_EXPIRATION_MS,
			internal.noteImages.cleanupPendingImage,
			{ noteImageId },
		);

		return { noteImageId, url };
	},
});

export const cleanupPendingImage = internalMutation({
	args: { noteImageId: v.id("noteImages") },
	returns: v.null(),
	handler: async (ctx, args) => {
		await deletePendingNoteImage(ctx, args.noteImageId);
		return null;
	},
});
