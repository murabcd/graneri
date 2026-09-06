import { z } from "zod";
import { isModelFilePartMediaType } from "./model-file-input.mjs";

export const MAX_LOCAL_FILE_UPLOADS = 10;
export const MAX_LOCAL_FILE_SAVE_BYTES = 50_000_000;

export const saveLocalFileSourceSchema = z.object({
	storageId: z
		.string()
		.min(1)
		.max(200)
		.describe("Owned file storageId from the conversation's file metadata."),
	relativePath: z
		.string()
		.min(1)
		.max(4096)
		.describe(
			"New file path relative to the shared folder. Its parent directory must exist; existing files are never overwritten.",
		),
});

export const resolveLocalFileDownload = async ({
	input,
	toolName,
	resolveStorageUrl,
}) => {
	if (toolName !== "save_local_file") return null;
	const { storageId } = saveLocalFileSourceSchema.parse(input);
	const url = await resolveStorageUrl(storageId);
	if (!url)
		throw new Error("The file is unavailable or does not belong to this chat.");
	return { storageId, url };
};

const storageIdSchema = z.string().min(1);
export const localToolDurationFields = {
	totalDurationMs: z.number().int().nonnegative().optional(),
};
const supportedFileMediaTypeSchema = z
	.string()
	.refine(isModelFilePartMediaType, "Unsupported local model file media type.");
const pendingFileSchema = z.object({
	filename: z.string().min(1),
	mediaType: supportedFileMediaTypeSchema,
	storageId: storageIdSchema,
});
const resolvedFileSchema = z.object({
	filename: z.string().min(1),
	mediaType: supportedFileMediaTypeSchema,
	providerMetadata: z.object({
		graneri: z.object({ storageId: storageIdSchema }),
	}),
	type: z.literal("file"),
	url: z.url(),
});
const textReadOutputSchema = z.object({
	content: z.string(),
	kind: z.literal("text"),
	lengthBytes: z.number().int().nonnegative(),
	mediaType: z.literal("text/plain; charset=utf-8"),
	nextOffsetBytes: z.number().int().nonnegative().nullable(),
	offsetBytes: z.number().int().nonnegative(),
	path: z.string(),
	sizeBytes: z.number().int().nonnegative(),
	truncated: z.boolean(),
	...localToolDurationFields,
});
const pendingFileReadOutputSchema = z.object({
	file: pendingFileSchema,
	kind: z.literal("file"),
	path: z.string(),
	sizeBytes: z.number().int().nonnegative(),
	...localToolDurationFields,
});
const resolvedFileReadOutputSchema = z.object({
	file: resolvedFileSchema,
	kind: z.literal("file"),
	path: z.string(),
	sizeBytes: z.number().int().nonnegative(),
	...localToolDurationFields,
});
const discoveryPageFields = {
	nextCursor: z.string().nullable(),
	visitedEntries: z.number().int().nonnegative(),
	excludedEntries: z.number().int().nonnegative(),
	skippedFiles: z.array(
		z.object({
			path: z.string(),
			reason: z.enum(["non_text", "size_limit"]),
		}),
	),
};
const pendingImageSearchOutputSchema = z.object({
	candidateImageCount: z.number().int().nonnegative(),
	kind: z.literal("image-search"),
	path: z.string(),
	results: z.array(
		z.object({
			file: pendingFileSchema,
			path: z.string(),
			sizeBytes: z.number().int().nonnegative(),
		}),
	),
	...discoveryPageFields,
	...localToolDurationFields,
});
const resolvedImageSearchOutputSchema = z.object({
	candidateImageCount: z.number().int().nonnegative(),
	kind: z.literal("image-search"),
	path: z.string(),
	results: z.array(
		z.object({
			file: resolvedFileSchema,
			path: z.string(),
			sizeBytes: z.number().int().nonnegative(),
		}),
	),
	...discoveryPageFields,
	...localToolDurationFields,
});
const textSearchOutputSchema = z.object({
	kind: z.literal("text-search"),
	matches: z.array(
		z.object({
			matchedPath: z.boolean(),
			matches: z.array(
				z.object({
					line: z.number().int().positive(),
					text: z.string(),
				}),
			),
			path: z.string(),
			sizeBytes: z.number().int().nonnegative(),
		}),
	),
	contentBytesRead: z.number().int().nonnegative(),
	...discoveryPageFields,
	...localToolDurationFields,
});
const searchInputSchema = z.object({
	contentType: z.enum(["text", "image"]).default("text"),
	maxResults: z.number().int().min(1).max(MAX_LOCAL_FILE_UPLOADS).default(5),
});
const pendingReadOutputSchema = z.discriminatedUnion("kind", [
	textReadOutputSchema,
	pendingFileReadOutputSchema,
]);
export const resolvedReadOutputSchema = z.discriminatedUnion("kind", [
	textReadOutputSchema,
	resolvedFileReadOutputSchema,
]);
const pendingSearchOutputSchema = z.discriminatedUnion("kind", [
	textSearchOutputSchema,
	pendingImageSearchOutputSchema,
]);
export const resolvedSearchOutputSchema = z.discriminatedUnion("kind", [
	textSearchOutputSchema,
	resolvedImageSearchOutputSchema,
]);

const resolveFile = async (file, resolveStorageUrl) => {
	const url = await resolveStorageUrl(file.storageId);
	if (!url) {
		throw new Error("Local file upload did not return a file URL.");
	}

	return {
		filename: file.filename,
		mediaType: file.mediaType,
		providerMetadata: {
			graneri: { storageId: file.storageId },
		},
		type: "file",
		url,
	};
};

export const getLocalFileUploadCount = ({ input, toolName }) => {
	if (toolName === "read_local_file") {
		return 1;
	}
	if (toolName === "search_local_files") {
		const parsed = searchInputSchema.parse(input);
		return parsed.contentType === "image" ? parsed.maxResults : 0;
	}
	return 0;
};

export const resolveLocalFileToolOutput = async ({
	output,
	resolveStorageUrl,
	toolName,
}) => {
	if (toolName === "read_local_file") {
		const parsed = pendingReadOutputSchema.parse(output);
		return parsed.kind === "file"
			? { ...parsed, file: await resolveFile(parsed.file, resolveStorageUrl) }
			: parsed;
	}
	if (toolName === "search_local_files") {
		const parsed = pendingSearchOutputSchema.parse(output);
		return parsed.kind === "image-search"
			? {
					...parsed,
					results: await Promise.all(
						parsed.results.map(async (result) => ({
							...result,
							file: await resolveFile(result.file, resolveStorageUrl),
						})),
					),
				}
			: parsed;
	}
	return output;
};

const toModelFilePart = (file, providerOptions) => ({
	data: { type: "url", url: new URL(file.url) },
	filename: file.filename,
	mediaType: file.mediaType,
	...(providerOptions && { providerOptions }),
	type: "file",
});

const createImageDetailProviderOptions = (mediaType, detail) =>
	mediaType.startsWith("image/") && (detail === "low" || detail === "high")
		? { openai: { imageDetail: detail } }
		: undefined;

export const readLocalFileOutputForModel = ({ input, output }) => {
	const parsed = resolvedReadOutputSchema.parse(output);
	if (parsed.kind === "text") {
		return { type: "json", value: parsed };
	}

	const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
	const isImage = parsed.file.mediaType.startsWith("image/");
	return {
		type: "content",
		value: [
			{
				text:
					prompt ||
					(isImage
						? `Inspect ${parsed.path}. Describe what is visible, extract readable text, and answer the user's question about this image.`
						: `Read ${parsed.path} and answer the user's question using its contents.`),
				type: "text",
			},
			toModelFilePart(
				parsed.file,
				createImageDetailProviderOptions(parsed.file.mediaType, input?.detail),
			),
		],
	};
};

export const searchLocalFilesOutputForModel = ({ input, output }) => {
	const parsed = resolvedSearchOutputSchema.parse(output);
	if (parsed.kind === "text-search") {
		return { type: "json", value: parsed };
	}

	const query = typeof input?.query === "string" ? input.query.trim() : "";
	const value = [
		{
			text: `Inspect this page of candidate images from ${parsed.path} for: ${query}. This is not an OCR or visual index. Discovery coverage: ${JSON.stringify({ nextCursor: parsed.nextCursor, visitedEntries: parsed.visitedEntries, excludedEntries: parsed.excludedEntries, skippedFiles: parsed.skippedFiles })}. Continue with nextCursor when more images need inspection.`,
			type: "text",
		},
	];

	for (const result of parsed.results) {
		value.push({
			text: `Candidate local path: ${result.path} (${result.sizeBytes} bytes).`,
			type: "text",
		});
		value.push(
			toModelFilePart(result.file, {
				openai: { imageDetail: "low" },
			}),
		);
	}

	return { type: "content", value };
};
