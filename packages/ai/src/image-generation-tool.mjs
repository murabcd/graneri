import { openai } from "@ai-sdk/openai";
import { generateImage } from "ai";
import { z } from "zod";
import { defineAiTool } from "./ai-tool-definition.mjs";
import { artifactSourceSchema } from "./artifact-authoring-contract.mjs";
import { extractTextFromUIMessage } from "./local-path-references.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

const IMAGE_GENERATION_MODEL_ID = "gpt-image-2";
const GENERATED_IMAGE_MEDIA_TYPE = "image/png";
const MAX_SOURCE_IMAGE_BYTES = 25 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const detectRasterImageMediaType = (bytes) => {
	if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
		return "image/png";
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}
	const gifSignature = String.fromCharCode(...bytes.slice(0, 6));
	if (gifSignature === "GIF87a" || gifSignature === "GIF89a") {
		return "image/gif";
	}
	if (
		String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
		String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
	) {
		return "image/webp";
	}
	return null;
};

const readBoundedResponse = async (response) => {
	if (!response.body) {
		throw new Error("The source image response did not contain a body.");
	}
	const reader = response.body.getReader();
	const chunks = [];
	let totalBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		totalBytes += value.byteLength;
		if (totalBytes > MAX_SOURCE_IMAGE_BYTES) {
			await reader.cancel();
			throw new Error("The source image exceeds the 25 MiB limit.");
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
};

const createGeneratedImageFilename = () =>
	`generated-image-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;

const toBlobPart = (bytes) =>
	bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

export const buildImageGenerationInstruction = () =>
	"When the user asks you to create or edit an image, use generate_image. For an edit, copy the source filename, media type, and Graneri storage id exactly from the relevant image metadata. Each result is saved as a new immutable PNG artifact; briefly confirm the result without embedding it in markdown.";

const imageActionPattern =
	/\b(add|change|create|crop|draw|edit|enhance|erase|generate|make|modify|recolor|remove|replace|resize|render|retouch|transform|update|upscale)\b/iu;
const imageTargetPattern =
	/\b(background|image|picture|photo|illustration|art|graphic|logo|avatar)\b/iu;

export const shouldEnableImageGeneration = (message) => {
	if (!message) {
		return false;
	}
	const text = extractTextFromUIMessage(message);
	return (
		imageActionPattern.test(text) &&
		(imageTargetPattern.test(text) ||
			message.parts.some(
				(part) => part.type === "file" && part.mediaType.startsWith("image/"),
			))
	);
};

export const createConvexGeneratedImageUploader =
	({ chatAttachmentsApi, client }) =>
	async (image) => {
		const uploadUrl = await client.mutation(
			chatAttachmentsApi.generateUploadUrl,
		);
		const uploadResponse = await fetch(uploadUrl, {
			method: "POST",
			headers: { "Content-Type": GENERATED_IMAGE_MEDIA_TYPE },
			body: new Blob([toBlobPart(image)], {
				type: GENERATED_IMAGE_MEDIA_TYPE,
			}),
		});

		if (!uploadResponse.ok) {
			throw new Error("Generated image upload failed.");
		}

		const result = await uploadResponse.json();
		if (!result.storageId) {
			throw new Error("Generated image upload did not return a storage id.");
		}

		const url = await client.mutation(chatAttachmentsApi.getUrl, {
			storageId: result.storageId,
		});

		if (!url) {
			throw new Error("Generated image upload did not return a file URL.");
		}

		return {
			filename: createGeneratedImageFilename(),
			mediaType: GENERATED_IMAGE_MEDIA_TYPE,
			providerMetadata: {
				graneri: {
					generatedBy: "ai",
					storageId: result.storageId,
				},
			},
			sizeBytes: image.byteLength,
			url,
		};
	};

export const createConvexSourceImageResolver =
	({ chatAttachmentsApi, chatId, client, workspaceId }) =>
	async (source) => {
		const url = await client.mutation(chatAttachmentsApi.getOwnedUrl, {
			workspaceId,
			chatId,
			storageId: source.storageId,
		});
		if (!url) {
			throw new Error("The source image is not available in this chat.");
		}
		return await downloadSourceImage({ source, url });
	};

export const downloadSourceImage = async ({ source, url }) => {
	if (!source.mediaType.startsWith("image/")) {
		throw new Error("The selected source is not an image.");
	}
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error("The source image could not be downloaded.");
	}
	const responseMediaType = response.headers
		.get("Content-Type")
		?.split(";", 1)[0]
		?.trim();
	if (
		responseMediaType &&
		responseMediaType !== "application/octet-stream" &&
		responseMediaType !== source.mediaType
	) {
		throw new Error("The source image media type does not match its metadata.");
	}
	const declaredSize = Number(response.headers.get("Content-Length"));
	if (Number.isFinite(declaredSize) && declaredSize > MAX_SOURCE_IMAGE_BYTES) {
		throw new Error("The source image exceeds the 25 MiB limit.");
	}
	const bytes = await readBoundedResponse(response);
	const detectedMediaType = detectRasterImageMediaType(bytes);
	if (!detectedMediaType || detectedMediaType !== source.mediaType) {
		throw new Error("The source image bytes do not match its metadata.");
	}
	return bytes;
};

const imageSourceSchema = artifactSourceSchema.refine(
	(source) => source.mediaType.startsWith("image/"),
	"Image sources must use an image media type.",
);

const imageGenerationInputSchema = z.discriminatedUnion("operation", [
	z.object({
		operation: z.literal("create"),
		prompt: z.string().min(1).max(20_000),
	}),
	z.object({
		mask: imageSourceSchema.optional(),
		operation: z.literal("edit"),
		prompt: z.string().min(1).max(20_000),
		sources: z.array(imageSourceSchema).min(1).max(4),
	}),
]);

export const parseImageGenerationInput = (value) =>
	imageGenerationInputSchema.parse(value);

export const createImageGenerationTool = ({
	resolveSourceImage,
	uploadGeneratedImage,
}) =>
	defineAiTool({
		name: "generate_image",
		description:
			"Create or edit an image artifact. For edits, pass the exact source image metadata and describe the requested change.",
		inputSchema: imageGenerationInputSchema,
		policy: {
			access: "write",
			approval: "not_required",
			capability: "generate",
			provider: "openai",
		},
		ui: toolUiMetadata.generate_image,
		execute: async (input) => {
			const prompt =
				input.operation === "create"
					? input.prompt
					: {
							images: await Promise.all(input.sources.map(resolveSourceImage)),
							text: input.prompt,
							...(input.mask && {
								mask: await resolveSourceImage(input.mask),
							}),
						};
			const { image } = await generateImage({
				model: openai.image(IMAGE_GENERATION_MODEL_ID),
				prompt,
			});
			if (image.mediaType !== GENERATED_IMAGE_MEDIA_TYPE) {
				throw new Error("Image generation returned an unsupported format.");
			}
			if (detectRasterImageMediaType(image.uint8Array) !== image.mediaType) {
				throw new Error("Image generation returned invalid image bytes.");
			}

			return {
				artifacts: [await uploadGeneratedImage(image.uint8Array)],
			};
		},
	}).toAITool();
