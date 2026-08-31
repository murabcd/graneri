import {
	assertModelFileMedia,
	MAX_MODEL_FILE_BYTES,
} from "@workspace/ai/model-file-input";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

export const MAX_NOTE_FILE_BYTES = Math.min(
	10 * 1024 * 1024,
	MAX_MODEL_FILE_BYTES,
);

type NoteFileUploadResult = FunctionReturnType<
	typeof internal.noteAttachmentUploads.registerUploadedFile
>;

const corsHeaders = {
	"Access-Control-Allow-Headers": "Authorization, Content-Type, X-File-Name",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Origin": "*",
};

const jsonResponse = (
	status: number,
	payload: NoteFileUploadResult | { error: string },
) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: {
			...corsHeaders,
			"Content-Type": "application/json",
		},
	});

export const handleNoteFileOptionsRequest = () =>
	new Response(null, { status: 204, headers: corsHeaders });

export const handleNoteFileUploadRequest = async (
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

	const contentLength = Number(request.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_NOTE_FILE_BYTES) {
		return jsonResponse(413, { error: "File must be 10 MB or smaller." });
	}

	const sourceBlob = await request.blob();
	if (sourceBlob.size === 0) {
		return jsonResponse(400, { error: "File is required." });
	}
	if (sourceBlob.size > MAX_NOTE_FILE_BYTES) {
		return jsonResponse(413, { error: "File must be 10 MB or smaller." });
	}

	const arrayBuffer = await sourceBlob.arrayBuffer();
	let mediaType: string;
	try {
		mediaType = assertModelFileMedia(new Uint8Array(arrayBuffer)).mediaType;
	} catch {
		return jsonResponse(415, {
			error: "Use UTF-8 text, an image, PDF, DOCX, XLSX, or PPTX file.",
		});
	}

	const encodedFilename = request.headers.get("x-file-name")?.trim() || "file";
	let rawFilename = encodedFilename;
	try {
		rawFilename = decodeURIComponent(encodedFilename);
	} catch {
		return jsonResponse(400, { error: "File name is invalid." });
	}
	const filename = rawFilename.trim().slice(0, 200) || "file";
	const storageId = await ctx.storage.store(
		new Blob([arrayBuffer], { type: mediaType }),
	);
	try {
		const result = await ctx.runMutation(
			internal.noteAttachmentUploads.registerUploadedFile,
			{
				ownerTokenIdentifier: identity.tokenIdentifier,
				workspaceId,
				noteId,
				storageId,
				filename,
				mediaType,
				sizeBytes: sourceBlob.size,
			},
		);
		return jsonResponse(201, result);
	} catch (error) {
		await ctx.storage.delete(storageId);
		if (error instanceof ConvexError) {
			return jsonResponse(400, { error: "Unable to attach this file." });
		}
		console.error("Note file registration failed", { error });
		return jsonResponse(500, { error: "Unable to attach this file." });
	}
};
