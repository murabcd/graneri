import type { WithoutSystemFields } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { syncChatMessageAttachmentReferences } from "./chatAttachmentReferences";
import { normalizeChatPreview } from "./chatFormatting";
import {
	type ChatMessageContent,
	writeChatMessageContent,
} from "./chatMessageContent";
import { requireConvexDocumentWithinLimit } from "./documentSize";

/** The caller validates the message and authorizes its chat before writing. */
export const writeChatMessage = async (
	ctx: MutationCtx,
	document: Omit<
		WithoutSystemFields<Doc<"chatMessages">>,
		"contentId" | "preview"
	> &
		ChatMessageContent,
) => {
	const existing = await ctx.db
		.query("chatMessages")
		.withIndex("by_chatId_and_messageId", (q) =>
			q.eq("chatId", document.chatId).eq("messageId", document.messageId),
		)
		.unique();
	const { partsJson, text, ...metadata } = document;
	const contentId = await writeChatMessageContent(
		ctx,
		{ partsJson, text },
		existing?.contentId,
	);
	const stored = {
		...metadata,
		contentId,
		preview: normalizeChatPreview(text),
	};
	requireConvexDocumentWithinLimit({
		document: stored,
		errorCode: "CHAT_MESSAGE_TOO_LARGE",
		message: "Chat message exceeds Convex's 1 MiB document limit.",
	});
	const id = existing?._id ?? (await ctx.db.insert("chatMessages", stored));
	if (existing) await ctx.db.replace(existing._id, stored);
	await syncChatMessageAttachmentReferences(ctx, document);
	return id;
};
