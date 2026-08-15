import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

export const NOTE_IMAGE_CONTENT_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
] as const;
type NoteImageContentType = (typeof NOTE_IMAGE_CONTENT_TYPES)[number];

const isNoteImageContentType = (value: string): value is NoteImageContentType =>
	NOTE_IMAGE_CONTENT_TYPES.some((contentType) => contentType === value);

export const MAX_NOTE_IMAGE_BYTES = 10 * 1024 * 1024;

type NoteImageUploadResult = FunctionReturnType<
	typeof internal.noteImages.registerUploadedImage
>;

const corsHeaders = {
	"Access-Control-Allow-Headers": "Authorization, Content-Type, X-File-Name",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Origin": "*",
};

const textDecoder = new TextDecoder();

const jsonResponse = (
	status: number,
	payload: NoteImageUploadResult | { error: string },
) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: {
			...corsHeaders,
			"Content-Type": "application/json",
		},
	});

const hasExpectedSignature = async (blob: Blob, contentType: string) => {
	const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
	switch (contentType) {
		case "image/jpeg":
			return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
		case "image/png":
			return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
				(value, index) => bytes[index] === value,
			);
		case "image/gif":
			return (
				textDecoder.decode(bytes.slice(0, 6)) === "GIF87a" ||
				textDecoder.decode(bytes.slice(0, 6)) === "GIF89a"
			);
		case "image/webp":
			return (
				textDecoder.decode(bytes.slice(0, 4)) === "RIFF" &&
				textDecoder.decode(bytes.slice(8, 12)) === "WEBP"
			);
		default:
			return false;
	}
};

export const handleNoteImageOptionsRequest = () =>
	new Response(null, { status: 204, headers: corsHeaders });

export const handleNoteImageUploadRequest = async (
	ctx: ActionCtx,
	request: Request,
) => {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		return jsonResponse(401, { error: "Authentication is required." });
	}

	const url = new URL(request.url);
	const workspaceId = url.searchParams.get("workspaceId")?.trim();
	const noteId = url.searchParams.get("noteId")?.trim();
	if (!workspaceId || !noteId) {
		return jsonResponse(400, { error: "Workspace and note are required." });
	}

	const contentType = request.headers.get("content-type")?.split(";", 1)[0];
	if (!contentType || !isNoteImageContentType(contentType)) {
		return jsonResponse(415, {
			error: "Use a JPEG, PNG, WebP, or GIF image.",
		});
	}

	const contentLength = Number(request.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_NOTE_IMAGE_BYTES) {
		return jsonResponse(413, { error: "Image must be 10 MB or smaller." });
	}

	const blob = await request.blob();
	if (blob.size === 0) {
		return jsonResponse(400, { error: "Image is required." });
	}
	if (blob.size > MAX_NOTE_IMAGE_BYTES) {
		return jsonResponse(413, { error: "Image must be 10 MB or smaller." });
	}
	if (!(await hasExpectedSignature(blob, contentType))) {
		return jsonResponse(415, { error: "The image file is invalid." });
	}

	const encodedFileName = request.headers.get("x-file-name")?.trim() || "image";
	let rawFileName = encodedFileName;
	try {
		rawFileName = decodeURIComponent(encodedFileName);
	} catch {
		return jsonResponse(400, { error: "Image file name is invalid." });
	}
	const fileName = rawFileName.trim().slice(0, 200) || "image";
	const storageId = await ctx.storage.store(blob);
	try {
		const result = await ctx.runMutation(
			internal.noteImages.registerUploadedImage,
			{
				ownerTokenIdentifier: identity.tokenIdentifier,
				workspaceId,
				noteId,
				storageId,
				fileName,
				contentType,
				size: blob.size,
			},
		);
		return jsonResponse(201, result);
	} catch (error) {
		await ctx.storage.delete(storageId);
		if (error instanceof ConvexError) {
			return jsonResponse(400, { error: "Unable to attach this image." });
		}
		console.error("Note image registration failed", { error });
		return jsonResponse(500, { error: "Unable to attach this image." });
	}
};
