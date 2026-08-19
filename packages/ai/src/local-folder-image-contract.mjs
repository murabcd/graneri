import { z } from "zod";

export const MAX_LOCAL_IMAGE_UPLOADS = 10;

const storageIdSchema = z.string().min(1);
const imageMediaTypeSchema = z.string().startsWith("image/");
const pendingImageFileSchema = z.object({
	filename: z.string().min(1),
	mediaType: imageMediaTypeSchema,
	storageId: storageIdSchema,
});
const resolvedImageFileSchema = z.object({
	filename: z.string().min(1),
	mediaType: imageMediaTypeSchema,
	providerMetadata: z.object({
		graneri: z.object({ storageId: storageIdSchema }),
	}),
	type: z.literal("file"),
	url: z.url(),
});
const pendingInspectedImageOutputSchema = z.object({
	file: pendingImageFileSchema,
	path: z.string(),
	sizeBytes: z.number().int().nonnegative(),
});
const resolvedInspectedImageOutputSchema = z.object({
	file: resolvedImageFileSchema,
	path: z.string(),
	sizeBytes: z.number().int().nonnegative(),
});
const pendingImageSearchOutputSchema = z.object({
	candidateImageCount: z.number().int().nonnegative(),
	path: z.string(),
	results: z.array(
		z.object({
			file: pendingImageFileSchema,
			path: z.string(),
			sizeBytes: z.number().int().nonnegative(),
		}),
	),
	totalImageCount: z.number().int().nonnegative(),
	truncated: z.boolean(),
});
const resolvedImageSearchOutputSchema = z.object({
	candidateImageCount: z.number().int().nonnegative(),
	path: z.string(),
	results: z.array(
		z.object({
			file: resolvedImageFileSchema,
			path: z.string(),
			sizeBytes: z.number().int().nonnegative(),
		}),
	),
	totalImageCount: z.number().int().nonnegative(),
	truncated: z.boolean(),
});
const imageSearchInputSchema = z.object({
	maxResults: z.number().int().min(1).max(MAX_LOCAL_IMAGE_UPLOADS).default(5),
});

const resolveImageFile = async (file, resolveStorageUrl) => {
	const url = await resolveStorageUrl(file.storageId);
	if (!url) {
		throw new Error("Local image upload did not return a file URL.");
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

export const getLocalImageUploadCount = ({ input, toolName }) => {
	if (toolName === "inspect_local_image") {
		return 1;
	}
	if (toolName === "search_local_images") {
		return imageSearchInputSchema.parse(input).maxResults;
	}
	return 0;
};

export const resolveLocalImageToolOutput = async ({
	output,
	resolveStorageUrl,
	toolName,
}) => {
	if (toolName === "inspect_local_image") {
		const parsed = pendingInspectedImageOutputSchema.parse(output);
		return {
			...parsed,
			file: await resolveImageFile(parsed.file, resolveStorageUrl),
		};
	}
	if (toolName === "search_local_images") {
		const parsed = pendingImageSearchOutputSchema.parse(output);
		return {
			...parsed,
			results: await Promise.all(
				parsed.results.map(async (result) => ({
					...result,
					file: await resolveImageFile(result.file, resolveStorageUrl),
				})),
			),
		};
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

const createImageDetailProviderOptions = (detail) =>
	detail === "low" || detail === "high"
		? { openai: { imageDetail: detail } }
		: undefined;

export const inspectedLocalImageOutputForModel = ({ input, output }) => {
	const parsed = resolvedInspectedImageOutputSchema.parse(output);
	const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";

	return {
		type: "content",
		value: [
			{
				text:
					prompt ||
					`Inspect ${parsed.path}. Describe what is visible, extract readable text, and answer the user's question about this image.`,
				type: "text",
			},
			toModelFilePart(
				parsed.file,
				createImageDetailProviderOptions(input?.detail),
			),
		],
	};
};

export const searchedLocalImagesOutputForModel = ({ input, output }) => {
	const parsed = resolvedImageSearchOutputSchema.parse(output);
	const query = typeof input?.query === "string" ? input.query.trim() : "";
	const value = [
		{
			text: `Inspect these candidate images from ${parsed.path} and rank the ones that best match: ${query}`,
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
