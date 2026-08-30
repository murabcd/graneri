import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { deleteFileStorageIfUnreferenced } from "./fileStorageReferences";

export const MAX_NOTE_ATTACHMENTS = 100;

export type NoteAttachmentAttributes = {
	noteAttachmentId: string;
	filename: string;
	mediaType: string;
	sizeBytes: number;
};

const releaseAttachmentIfUnreferenced = async (
	ctx: MutationCtx,
	noteAttachmentId: Id<"noteAttachmentReferences">,
) => {
	const documentReference = await ctx.db
		.query("noteAttachmentDocumentReferences")
		.withIndex("by_noteAttachmentId", (query) =>
			query.eq("noteAttachmentId", noteAttachmentId),
		)
		.first();
	if (documentReference) {
		return;
	}

	const attachment = await ctx.db.get(noteAttachmentId);
	if (!attachment) {
		return;
	}

	await ctx.db.delete(noteAttachmentId);
	await deleteFileStorageIfUnreferenced(ctx, attachment.storageId);
};

export const copyChatMessageAttachmentsToNote = async (
	ctx: MutationCtx,
	args: {
		chatId: Id<"chats">;
		messageId: string;
		noteId: Id<"notes">;
		now: number;
	},
): Promise<NoteAttachmentAttributes[]> => {
	const chatReferences = await ctx.db
		.query("chatAttachmentReferences")
		.withIndex("by_chatId_and_messageId", (query) =>
			query.eq("chatId", args.chatId).eq("messageId", args.messageId),
		)
		.take(MAX_NOTE_ATTACHMENTS + 1);
	if (chatReferences.length > MAX_NOTE_ATTACHMENTS) {
		throw new ConvexError({
			code: "TOO_MANY_NOTE_ATTACHMENTS",
			message: `A note can capture at most ${MAX_NOTE_ATTACHMENTS} attachments from one response.`,
		});
	}

	return await Promise.all(
		chatReferences.map(async (reference) => {
			const noteAttachmentId = await ctx.db.insert("noteAttachmentReferences", {
				noteId: args.noteId,
				storageId: reference.storageId,
				filename: reference.filename,
				mediaType: reference.mediaType,
				sizeBytes: reference.sizeBytes,
				createdAt: args.now,
			});
			return {
				noteAttachmentId,
				filename: reference.filename,
				mediaType: reference.mediaType,
				sizeBytes: reference.sizeBytes,
			};
		}),
	);
};

export const getOwnedNoteAttachment = async (
	ctx: QueryCtx,
	args: {
		noteAttachmentId: Id<"noteAttachmentReferences">;
		ownerTokenIdentifier: string;
	},
) => {
	const attachment = await ctx.db.get(args.noteAttachmentId);
	if (!attachment) {
		return null;
	}
	const note = await ctx.db.get(attachment.noteId);
	if (
		!note ||
		note.isArchived ||
		note.ownerTokenIdentifier !== args.ownerTokenIdentifier
	) {
		return null;
	}
	const url = await ctx.storage.getUrl(attachment.storageId);
	return url ? { ...attachment, url } : null;
};

export const syncNoteAttachmentDocumentReferences = async ({
	ctx,
	note,
	revisionId,
	attachments,
}: {
	ctx: MutationCtx;
	note: Doc<"notes">;
	revisionId: Id<"noteRevisions"> | null;
	attachments: NoteAttachmentAttributes[];
}) => {
	const attachmentIds = await Promise.all(
		attachments.map(async (attributes) => {
			const noteAttachmentId = await ctx.db.normalizeId(
				"noteAttachmentReferences",
				attributes.noteAttachmentId,
			);
			if (!noteAttachmentId) {
				throw new ConvexError({
					code: "INVALID_NOTE_ATTACHMENT",
					message: "This file does not belong to the note.",
				});
			}
			const attachment = await ctx.db.get(noteAttachmentId);
			if (
				!attachment ||
				attachment.noteId !== note._id ||
				attachment.filename !== attributes.filename ||
				attachment.mediaType !== attributes.mediaType ||
				attachment.sizeBytes !== attributes.sizeBytes
			) {
				throw new ConvexError({
					code: "INVALID_NOTE_ATTACHMENT",
					message: "This file does not belong to the note.",
				});
			}
			return noteAttachmentId;
		}),
	);
	const nextAttachmentIds = new Set(attachmentIds);
	const existingReferences = await ctx.db
		.query("noteAttachmentDocumentReferences")
		.withIndex("by_noteId_and_revisionId", (query) =>
			query.eq("noteId", note._id).eq("revisionId", revisionId),
		)
		.collect();
	const existingAttachmentIds = new Set(
		existingReferences.map((reference) => reference.noteAttachmentId),
	);

	await Promise.all(
		attachmentIds.flatMap((noteAttachmentId) =>
			existingAttachmentIds.has(noteAttachmentId)
				? []
				: [
						ctx.db.insert("noteAttachmentDocumentReferences", {
							noteId: note._id,
							revisionId,
							noteAttachmentId,
						}),
					],
		),
	);

	for (const reference of existingReferences) {
		if (nextAttachmentIds.has(reference.noteAttachmentId)) {
			continue;
		}
		await ctx.db.delete(reference._id);
		await releaseAttachmentIfUnreferenced(ctx, reference.noteAttachmentId);
	}

	if (revisionId !== null) {
		return;
	}
	const noteAttachments = await ctx.db
		.query("noteAttachmentReferences")
		.withIndex("by_noteId", (query) => query.eq("noteId", note._id))
		.take(MAX_NOTE_ATTACHMENTS);
	for (const attachment of noteAttachments) {
		await releaseAttachmentIfUnreferenced(ctx, attachment._id);
	}
};

export const removeNoteAttachmentDocumentReferences = async ({
	ctx,
	noteId,
	revisionId,
}: {
	ctx: MutationCtx;
	noteId: Id<"notes">;
	revisionId: Id<"noteRevisions"> | null;
}) => {
	const references = await ctx.db
		.query("noteAttachmentDocumentReferences")
		.withIndex("by_noteId_and_revisionId", (query) =>
			query.eq("noteId", noteId).eq("revisionId", revisionId),
		)
		.collect();

	for (const reference of references) {
		await ctx.db.delete(reference._id);
		await releaseAttachmentIfUnreferenced(ctx, reference.noteAttachmentId);
	}
};

export const removeNoteAttachments = async (
	ctx: MutationCtx,
	noteId: Id<"notes">,
) => {
	const references = await ctx.db
		.query("noteAttachmentDocumentReferences")
		.withIndex("by_noteId_and_revisionId", (query) =>
			query.eq("noteId", noteId),
		)
		.collect();
	await Promise.all(
		references.map((reference) => ctx.db.delete(reference._id)),
	);

	const attachments = await ctx.db
		.query("noteAttachmentReferences")
		.withIndex("by_noteId", (query) => query.eq("noteId", noteId))
		.take(MAX_NOTE_ATTACHMENTS);
	for (const attachment of attachments) {
		await ctx.db.delete(attachment._id);
	}
	for (const attachment of attachments) {
		await deleteFileStorageIfUnreferenced(ctx, attachment.storageId);
	}
};

export const deletePendingNoteAttachment = releaseAttachmentIfUnreferenced;
