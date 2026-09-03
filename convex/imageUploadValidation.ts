import { v } from "convex/values";

export const IMAGE_CONTENT_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
] as const;

export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

export const imageContentTypeValidator = v.union(
	v.literal("image/jpeg"),
	v.literal("image/png"),
	v.literal("image/webp"),
	v.literal("image/gif"),
);

export const isImageContentType = (value: string): value is ImageContentType =>
	IMAGE_CONTENT_TYPES.some((contentType) => contentType === value);

const textDecoder = new TextDecoder();

export const hasExpectedImageSignature = async (
	blob: Blob,
	contentType: ImageContentType,
) => {
	const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
	switch (contentType) {
		case "image/jpeg":
			return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
		case "image/png":
			return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
				(value, index) => bytes[index] === value,
			);
		case "image/gif": {
			const signature = textDecoder.decode(bytes.slice(0, 6));
			return signature === "GIF87a" || signature === "GIF89a";
		}
		case "image/webp":
			return (
				textDecoder.decode(bytes.slice(0, 4)) === "RIFF" &&
				textDecoder.decode(bytes.slice(8, 12)) === "WEBP"
			);
	}
};
