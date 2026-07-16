import { parseUiMessagePartsJson } from "@workspace/ai/ui-message-codec";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const CONVEX_STORAGE_PATH_SEGMENT = "/api/storage/";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const getStorageIdFromFilePart = (part: unknown) => {
	if (!isRecord(part) || part.type !== "file") {
		return null;
	}

	const providerMetadata = part.providerMetadata;
	if (isRecord(providerMetadata)) {
		const graneriMetadata = providerMetadata.graneri;
		if (
			isRecord(graneriMetadata) &&
			typeof graneriMetadata.storageId === "string"
		) {
			return graneriMetadata.storageId;
		}
	}

	if (typeof part.url !== "string") {
		return null;
	}
	let url: URL;
	try {
		url = new URL(part.url);
	} catch {
		throw new ConvexError({
			code: "INVALID_CHAT_ATTACHMENT_METADATA",
			message: "Chat attachment URL is invalid.",
		});
	}
	const storagePathIndex = url.pathname.indexOf(CONVEX_STORAGE_PATH_SEGMENT);
	if (storagePathIndex === -1) {
		return null;
	}
	return (
		url.pathname
			.slice(storagePathIndex + CONVEX_STORAGE_PATH_SEGMENT.length)
			.split("/")[0] ?? null
	);
};

const getAttachmentStorageIds = (
	ctx: MutationCtx,
	partsJson: string,
): Set<Id<"_storage">> => {
	let parts;
	try {
		parts = parseUiMessagePartsJson(partsJson);
	} catch (error) {
		throw new ConvexError({
			code: "INVALID_CHAT_ATTACHMENT_METADATA",
			message:
				error instanceof Error
					? error.message
					: "Chat attachment metadata is invalid.",
		});
	}

	const storageIds = new Set<Id<"_storage">>();
	for (const part of parts) {
		const value = getStorageIdFromFilePart(part);
		if (!value) {
			continue;
		}
		const storageId = ctx.db.system.normalizeId("_storage", value);
		if (!storageId) {
			throw new ConvexError({
				code: "INVALID_CHAT_ATTACHMENT_STORAGE_ID",
				message: "Chat attachment storage id is invalid.",
			});
		}
		storageIds.add(storageId);
	}
	return storageIds;
};

const releaseReference = async (
	ctx: MutationCtx,
	reference: {
		_id: Id<"chatAttachmentReferences">;
		storageId: Id<"_storage">;
	},
) => {
	await ctx.db.delete(reference._id);
	const remainingReference = await ctx.db
		.query("chatAttachmentReferences")
		.withIndex("by_storageId", (q) => q.eq("storageId", reference.storageId))
		.first();
	if (!remainingReference) {
		const metadata = await ctx.db.system.get(reference.storageId);
		if (metadata) {
			await ctx.storage.delete(reference.storageId);
		}
	}
};

export const syncChatMessageAttachmentReferences = async (
	ctx: MutationCtx,
	args: {
		chatId: Id<"chats">;
		messageId: string;
		partsJson: string;
	},
) => {
	const nextStorageIds = getAttachmentStorageIds(ctx, args.partsJson);
	const existingReferences = await ctx.db
		.query("chatAttachmentReferences")
		.withIndex("by_chatId_and_messageId", (q) =>
			q.eq("chatId", args.chatId).eq("messageId", args.messageId),
		)
		.collect();
	const existingStorageIds = new Set(
		existingReferences.map((reference) => reference.storageId),
	);

	for (const storageId of nextStorageIds) {
		if (existingStorageIds.has(storageId)) {
			continue;
		}
		const metadata = await ctx.db.system.get(storageId);
		if (!metadata) {
			throw new ConvexError({
				code: "CHAT_ATTACHMENT_NOT_FOUND",
				message: "Chat attachment was not found.",
			});
		}
		await ctx.db.insert("chatAttachmentReferences", {
			chatId: args.chatId,
			messageId: args.messageId,
			storageId,
		});
	}

	for (const reference of existingReferences) {
		if (!nextStorageIds.has(reference.storageId)) {
			await releaseReference(ctx, reference);
		}
	}
};

export const deleteChatMessageAttachmentReferences = async (
	ctx: MutationCtx,
	messages: ReadonlyArray<{ chatId: Id<"chats">; messageId: string }>,
) => {
	for (const message of messages) {
		const references = await ctx.db
			.query("chatAttachmentReferences")
			.withIndex("by_chatId_and_messageId", (q) =>
				q.eq("chatId", message.chatId).eq("messageId", message.messageId),
			)
			.collect();
		for (const reference of references) {
			await releaseReference(ctx, reference);
		}
	}
};
