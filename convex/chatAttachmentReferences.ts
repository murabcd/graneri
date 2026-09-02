import { ARTIFACT_AUTHORING_TOOL_NAMES } from "@workspace/ai/artifact-authoring-contract";
import { parseUiMessagePartsJson } from "@workspace/ai/ui-message-codec";
import { ConvexError } from "convex/values";
import { z } from "zod";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { deleteFileStorageIfUnreferenced } from "./fileStorageReferences";

const storedFilePartSchema = z.object({
	filename: z.string().min(1),
	mediaType: z.string().min(1),
	providerMetadata: z.object({
		graneri: z.object({
			sizeBytes: z.number().int().nonnegative().optional(),
			storageId: z.string().min(1),
		}),
	}),
	type: z.literal("file"),
});
const generatedAttachmentSchema = z.object({
	filename: z.string().min(1),
	mediaType: z.string().min(1),
	providerMetadata: z.object({
		graneri: z.object({ storageId: z.string().min(1) }),
	}),
	sizeBytes: z.number().int().nonnegative(),
});
const authoredArtifactsOutputSchema = z.object({
	artifacts: z.array(generatedAttachmentSchema),
});
const documentToolPartType =
	`tool-${ARTIFACT_AUTHORING_TOOL_NAMES.document}` as const;
const pdfToolPartType = `tool-${ARTIFACT_AUTHORING_TOOL_NAMES.pdf}` as const;
const presentationToolPartType =
	`tool-${ARTIFACT_AUTHORING_TOOL_NAMES.presentation}` as const;
const spreadsheetToolPartType =
	`tool-${ARTIFACT_AUTHORING_TOOL_NAMES.spreadsheet}` as const;
const authoredArtifactToolPartTypes = [
	documentToolPartType,
	pdfToolPartType,
	presentationToolPartType,
	spreadsheetToolPartType,
] as const;
const attachmentBearingToolPartSchema = z.union([
	z.object({
		output: authoredArtifactsOutputSchema,
		state: z.literal("output-available"),
		type: z.literal("tool-generate_image"),
	}),
	z.object({
		output: authoredArtifactsOutputSchema,
		state: z.literal("output-available"),
		type: z.enum(authoredArtifactToolPartTypes),
	}),
	z.object({
		output: z.object({
			file: storedFilePartSchema,
			sizeBytes: z.number().int().nonnegative(),
		}),
		state: z.literal("output-available"),
		type: z.literal("tool-read_local_file"),
	}),
	z.object({
		output: z.object({
			results: z.array(
				z.object({
					file: storedFilePartSchema,
					sizeBytes: z.number().int().nonnegative(),
				}),
			),
		}),
		state: z.literal("output-available"),
		type: z.literal("tool-search_local_files"),
	}),
]);

type UnnormalizedAttachmentReference = {
	filename: string;
	mediaType: string;
	sizeBytes: number;
	storageId: string;
};

const toAttachmentReference = (
	file: z.infer<typeof storedFilePartSchema>,
	sizeBytes: number | undefined = file.providerMetadata.graneri.sizeBytes,
): UnnormalizedAttachmentReference | null =>
	sizeBytes === undefined
		? null
		: {
				filename: file.filename,
				mediaType: file.mediaType,
				sizeBytes,
				storageId: file.providerMetadata.graneri.storageId,
			};

const getAttachmentReferenceFromFilePart = (part: unknown) => {
	const result = storedFilePartSchema.safeParse(part);
	return result.success ? toAttachmentReference(result.data) : null;
};

const getAttachmentReferencesFromToolPart = (part: unknown) => {
	const result = attachmentBearingToolPartSchema.safeParse(part);
	if (!result.success) {
		return [];
	}

	switch (result.data.type) {
		case "tool-generate_image":
		case documentToolPartType:
		case pdfToolPartType:
		case presentationToolPartType:
		case spreadsheetToolPartType:
			return result.data.output.artifacts.map((artifact) => ({
				filename: artifact.filename,
				mediaType: artifact.mediaType,
				sizeBytes: artifact.sizeBytes,
				storageId: artifact.providerMetadata.graneri.storageId,
			}));
		case "tool-read_local_file":
			return [
				toAttachmentReference(
					result.data.output.file,
					result.data.output.sizeBytes,
				),
			];
		case "tool-search_local_files":
			return result.data.output.results.map((imageResult) =>
				toAttachmentReference(imageResult.file, imageResult.sizeBytes),
			);
	}
};

const getAttachmentReferences = (
	ctx: MutationCtx,
	partsJson: string,
): Map<Id<"_storage">, Omit<UnnormalizedAttachmentReference, "storageId">> => {
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

	const references = new Map<
		Id<"_storage">,
		Omit<UnnormalizedAttachmentReference, "storageId">
	>();
	for (const part of parts) {
		const values = [
			getAttachmentReferenceFromFilePart(part),
			...getAttachmentReferencesFromToolPart(part),
		];
		for (const value of values) {
			if (!value) {
				continue;
			}
			const storageId = ctx.db.system.normalizeId("_storage", value.storageId);
			if (!storageId) {
				throw new ConvexError({
					code: "INVALID_CHAT_ATTACHMENT_STORAGE_ID",
					message: "Chat attachment storage id is invalid.",
				});
			}
			if (!references.has(storageId)) {
				references.set(storageId, {
					filename: value.filename,
					mediaType: value.mediaType,
					sizeBytes: value.sizeBytes,
				});
			}
		}
	}
	return references;
};

const releaseReference = async (
	ctx: MutationCtx,
	reference: {
		_id: Id<"chatAttachmentReferences">;
		storageId: Id<"_storage">;
	},
) => {
	await ctx.db.delete(reference._id);
	await deleteFileStorageIfUnreferenced(ctx, reference.storageId);
};

export const syncChatMessageAttachmentReferences = async (
	ctx: MutationCtx,
	args: {
		chatId: Id<"chats">;
		messageId: string;
		partsJson: string;
	},
) => {
	const nextReferences = getAttachmentReferences(ctx, args.partsJson);
	const existingReferences = await ctx.db
		.query("chatAttachmentReferences")
		.withIndex("by_chatId_and_messageId", (q) =>
			q.eq("chatId", args.chatId).eq("messageId", args.messageId),
		)
		.collect();
	const existingByStorageId = new Map(
		existingReferences.map((reference) => [reference.storageId, reference]),
	);

	for (const [storageId, attachment] of nextReferences) {
		const existingReference = existingByStorageId.get(storageId);
		if (existingReference) {
			if (
				existingReference.filename !== attachment.filename ||
				existingReference.mediaType !== attachment.mediaType ||
				existingReference.sizeBytes !== attachment.sizeBytes
			) {
				await ctx.db.patch(existingReference._id, attachment);
			}
			continue;
		}
		const storageMetadata = await ctx.db.system.get(storageId);
		if (!storageMetadata) {
			throw new ConvexError({
				code: "CHAT_ATTACHMENT_NOT_FOUND",
				message: "Chat attachment was not found.",
			});
		}
		await ctx.db.insert("chatAttachmentReferences", {
			chatId: args.chatId,
			messageId: args.messageId,
			storageId,
			...attachment,
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
		if (!nextReferences.has(reference.storageId)) {
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
