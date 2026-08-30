import { parseUiMessagePartsJson } from "@workspace/ai/ui-message-codec";
import { ConvexError } from "convex/values";
import { z } from "zod";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const CONVEX_STORAGE_PATH_SEGMENT = "/api/storage/";

const attachmentArtifactSchema = z.object({
	providerMetadata: z
		.object({
			graneri: z.object({ storageId: z.string() }).optional(),
		})
		.optional(),
	url: z.string().optional(),
});
const filePartSchema = attachmentArtifactSchema.extend({
	type: z.literal("file"),
});
const authoredArtifactsOutputSchema = z.object({
	artifacts: z.array(attachmentArtifactSchema),
});
const attachmentBearingToolPartSchema = z.discriminatedUnion("type", [
	z.object({
		output: authoredArtifactsOutputSchema,
		state: z.literal("output-available"),
		type: z.literal("tool-generate_image"),
	}),
	z.object({
		output: authoredArtifactsOutputSchema,
		state: z.literal("output-available"),
		type: z.literal("tool-author_artifact"),
	}),
	z.object({
		output: z.object({ file: filePartSchema }),
		state: z.literal("output-available"),
		type: z.literal("tool-read_local_file"),
	}),
	z.object({
		output: z.object({
			results: z.array(z.object({ file: filePartSchema })),
		}),
		state: z.literal("output-available"),
		type: z.literal("tool-search_local_files"),
	}),
]);

const getStorageIdFromAttachmentArtifact = (
	artifact: z.infer<typeof attachmentArtifactSchema>,
) => {
	if (artifact.providerMetadata?.graneri) {
		return artifact.providerMetadata.graneri.storageId;
	}

	if (!artifact.url) {
		return null;
	}
	let url: URL;
	try {
		url = new URL(artifact.url);
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

const getStorageIdFromFilePart = (part: unknown) => {
	const result = filePartSchema.safeParse(part);
	return result.success
		? getStorageIdFromAttachmentArtifact(result.data)
		: null;
};

const getStorageIdsFromToolPart = (part: unknown) => {
	const result = attachmentBearingToolPartSchema.safeParse(part);
	if (!result.success) {
		return [];
	}

	switch (result.data.type) {
		case "tool-generate_image":
		case "tool-author_artifact":
			return result.data.output.artifacts.map((artifact) =>
				getStorageIdFromAttachmentArtifact(artifact),
			);
		case "tool-read_local_file":
			return [getStorageIdFromFilePart(result.data.output.file)];
		case "tool-search_local_files":
			return result.data.output.results.map((imageResult) =>
				getStorageIdFromFilePart(imageResult.file),
			);
	}
};

const getAttachmentStorageIds = (
	ctx: MutationCtx,
	partsJson: string,
): Set<Id<"_storage">> => {
	let parts: unknown[];
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
		const values = [
			getStorageIdFromFilePart(part),
			...getStorageIdsFromToolPart(part),
		];
		for (const value of values) {
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
		const artifactOutput = await ctx.db
			.query("artifactJobOutputs")
			.withIndex("by_storageId", (query) =>
				query.eq("storageId", reference.storageId),
			)
			.unique();
		if (artifactOutput) {
			await ctx.db.delete(artifactOutput._id);
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
		const artifactOutput = await ctx.db
			.query("artifactJobOutputs")
			.withIndex("by_storageId", (query) => query.eq("storageId", storageId))
			.unique();
		if (artifactOutput && !artifactOutput.claimed) {
			const artifactJob = await ctx.db.get(artifactOutput.jobId);
			if (!artifactJob || artifactJob.chatId !== args.chatId) {
				throw new ConvexError({
					code: "INVALID_ARTIFACT_OUTPUT_OWNER",
					message: "Authored artifact does not belong to this chat.",
				});
			}
			await ctx.db.patch(artifactOutput._id, { claimed: true });
		}
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
