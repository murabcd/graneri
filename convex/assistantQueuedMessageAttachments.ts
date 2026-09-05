import {
	MAX_QUEUED_CHAT_FILES,
	parseQueuedChatFilesJson,
} from "@workspace/ai/queued-chat-files";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { deleteFileStorageIfUnreferenced } from "./fileStorageReferences";

export const syncQueuedMessageAttachments = async (
	ctx: MutationCtx,
	queuedMessageId: Id<"assistantQueuedMessages">,
	filesJson: string,
) => {
	const files = parseQueuedChatFilesJson(filesJson);
	const existing = await ctx.db
		.query("queuedMessageAttachmentReferences")
		.withIndex("by_queuedMessageId", (q) =>
			q.eq("queuedMessageId", queuedMessageId),
		)
		.take(MAX_QUEUED_CHAT_FILES);
	const next = new Set<Id<"_storage">>();
	for (const file of files) {
		const storageId = ctx.db.system.normalizeId(
			"_storage",
			file.providerMetadata.graneri.storageId,
		);
		const metadata = storageId ? await ctx.db.system.get(storageId) : null;
		if (
			!storageId ||
			!metadata ||
			metadata.size !== file.providerMetadata.graneri.sizeBytes ||
			(await ctx.storage.getUrl(storageId)) !== file.url
		) {
			throw new ConvexError({
				code: "INVALID_QUEUED_ATTACHMENT",
				message: "Queued attachment must reference an uploaded file.",
			});
		}
		if (
			!next.has(storageId) &&
			!existing.some((ref) => ref.storageId === storageId)
		) {
			await ctx.db.insert("queuedMessageAttachmentReferences", {
				queuedMessageId,
				storageId,
			});
		}
		next.add(storageId);
	}
	for (const reference of existing) {
		if (!next.has(reference.storageId)) {
			await ctx.db.delete(reference._id);
			await deleteFileStorageIfUnreferenced(ctx, reference.storageId);
		}
	}
};

export const deleteQueuedMessage = async (
	ctx: MutationCtx,
	queuedMessageId: Id<"assistantQueuedMessages">,
) => {
	await syncQueuedMessageAttachments(ctx, queuedMessageId, "[]");
	await ctx.db.delete(queuedMessageId);
};
