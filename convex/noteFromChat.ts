import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import {
	createResourceAccess,
	getAuthorName,
	requireOwnedWorkspace,
} from "./domain";
import { copyChatMessageAttachmentsToNote } from "./noteAttachmentReferences";
import { parseNoteDocument } from "./noteDocument";
import { insertNote } from "./noteRecords";

const { requireIdentity } = createResourceAccess("notes");

export const create = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		messageId: v.string(),
		title: v.string(),
		content: v.string(),
		searchableText: v.string(),
	},
	returns: v.id("notes"),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const chat = await ctx.db
			.query("chats")
			.withIndex(
				"by_ownerTokenIdentifier_and_workspaceId_and_chatId",
				(query) =>
					query
						.eq("ownerTokenIdentifier", ownerTokenIdentifier)
						.eq("workspaceId", args.workspaceId)
						.eq("chatId", args.chatId),
			)
			.unique();
		if (!chat || chat.isArchived) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}

		const message = await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId_and_messageId", (query) =>
				query.eq("chatId", chat._id).eq("messageId", args.messageId),
			)
			.unique();
		if (
			!message ||
			message.ownerTokenIdentifier !== ownerTokenIdentifier ||
			message.role !== "assistant"
		) {
			throw new ConvexError({
				code: "CHAT_MESSAGE_NOT_FOUND",
				message: "Assistant response not found.",
			});
		}

		const now = Date.now();
		const noteId = await insertNote(ctx, {
			authorName: getAuthorName(identity),
			document: parseNoteDocument(args.content),
			now,
			ownerTokenIdentifier,
			searchableText: args.searchableText,
			title: args.title,
			workspaceId: args.workspaceId,
		});
		await copyChatMessageAttachmentsToNote(ctx, {
			chatId: chat._id,
			messageId: message.messageId,
			noteId,
			now,
		});

		return noteId;
	},
});
