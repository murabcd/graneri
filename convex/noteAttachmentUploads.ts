import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { requireOwnedWorkspace } from "./domain";
import {
	deletePendingNoteAttachment,
	MAX_NOTE_ATTACHMENTS,
} from "./noteAttachmentReferences";
import { ensureOwnedNote } from "./notes";

const PENDING_NOTE_ATTACHMENT_EXPIRATION_MS = 60 * 60 * 1000;

export const registerUploadedFile = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.string(),
		noteId: v.string(),
		storageId: v.id("_storage"),
		filename: v.string(),
		mediaType: v.string(),
		sizeBytes: v.number(),
	},
	returns: v.object({
		noteAttachmentId: v.id("noteAttachmentReferences"),
		filename: v.string(),
		mediaType: v.string(),
		sizeBytes: v.number(),
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

		const existingAttachments = await ctx.db
			.query("noteAttachmentReferences")
			.withIndex("by_noteId", (query) => query.eq("noteId", noteId))
			.take(MAX_NOTE_ATTACHMENTS);
		if (existingAttachments.length >= MAX_NOTE_ATTACHMENTS) {
			throw new ConvexError({
				code: "TOO_MANY_NOTE_ATTACHMENTS",
				message: "Remove a file before uploading another one.",
			});
		}

		const noteAttachmentId = await ctx.db.insert("noteAttachmentReferences", {
			noteId,
			storageId: args.storageId,
			filename: args.filename,
			mediaType: args.mediaType,
			sizeBytes: args.sizeBytes,
			createdAt: Date.now(),
		});
		await ctx.scheduler.runAfter(
			PENDING_NOTE_ATTACHMENT_EXPIRATION_MS,
			internal.noteAttachmentUploads.cleanupPendingFile,
			{ noteAttachmentId },
		);

		return {
			noteAttachmentId,
			filename: args.filename,
			mediaType: args.mediaType,
			sizeBytes: args.sizeBytes,
		};
	},
});

export const cleanupPendingFile = internalMutation({
	args: { noteAttachmentId: v.id("noteAttachmentReferences") },
	returns: v.null(),
	handler: async (ctx, args) => {
		await deletePendingNoteAttachment(ctx, args.noteAttachmentId);
		return null;
	},
});
