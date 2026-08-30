import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { deleteFileStorageIfUnreferenced } from "./fileStorageReferences";

export const MAX_NOTE_ATTACHMENTS = 100;

export const copyChatMessageAttachmentsToNote = async (
	ctx: MutationCtx,
	args: {
		chatId: Id<"chats">;
		messageId: string;
		noteId: Id<"notes">;
		now: number;
	},
) => {
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

	for (const reference of chatReferences) {
		await ctx.db.insert("noteAttachmentReferences", {
			noteId: args.noteId,
			storageId: reference.storageId,
			filename: reference.filename,
			mediaType: reference.mediaType,
			sizeBytes: reference.sizeBytes,
			createdAt: args.now,
		});
	}
};

export const listNoteAttachments = async (
	ctx: QueryCtx,
	noteId: Id<"notes">,
) => {
	const references = await ctx.db
		.query("noteAttachmentReferences")
		.withIndex("by_noteId", (query) => query.eq("noteId", noteId))
		.take(MAX_NOTE_ATTACHMENTS);

	return await Promise.all(
		references.map(async (reference) => {
			const url = await ctx.storage.getUrl(reference.storageId);
			if (!url) {
				throw new ConvexError({
					code: "NOTE_ATTACHMENT_NOT_FOUND",
					message: "A note attachment is no longer available.",
				});
			}

			return {
				filename: reference.filename,
				mediaType: reference.mediaType,
				sizeBytes: reference.sizeBytes,
				storageId: reference.storageId,
				url,
			};
		}),
	);
};

export const removeNoteAttachments = async (
	ctx: MutationCtx,
	noteId: Id<"notes">,
) => {
	const references = await ctx.db
		.query("noteAttachmentReferences")
		.withIndex("by_noteId", (query) => query.eq("noteId", noteId))
		.take(MAX_NOTE_ATTACHMENTS);

	for (const reference of references) {
		await ctx.db.delete(reference._id);
	}
	for (const reference of references) {
		await deleteFileStorageIfUnreferenced(ctx, reference.storageId);
	}
};
