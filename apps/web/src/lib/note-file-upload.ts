import { MODEL_FILE_INPUT_ACCEPT } from "@workspace/ai/model-file-input";
import { z } from "zod";
import type { Id } from "../../../../convex/_generated/dataModel";
import { getCachedConvexToken } from "./convex-token";
import { getConvexSiteUrl } from "./runtime-config";

export const NOTE_FILE_ACCEPT = MODEL_FILE_INPUT_ACCEPT;
export const MAX_NOTE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_NOTE_FILE_UPLOAD_BATCH = 10;

const uploadResultSchema = z.object({
	noteAttachmentId: z.string(),
	filename: z.string().min(1),
	mediaType: z.string().min(1),
	sizeBytes: z.number().int().nonnegative(),
});

const uploadErrorSchema = z.object({ error: z.string() });

export type UploadedNoteFile = {
	noteAttachmentId: Id<"noteAttachmentReferences">;
	filename: string;
	mediaType: string;
	sizeBytes: number;
};

export const validateNoteFileSelection = (files: File[]) => {
	if (files.length > MAX_NOTE_FILE_UPLOAD_BATCH) {
		throw new Error(
			`Upload no more than ${MAX_NOTE_FILE_UPLOAD_BATCH} files at once.`,
		);
	}

	for (const file of files) {
		if (file.size === 0) {
			throw new Error("The file is empty.");
		}
		if (file.size > MAX_NOTE_FILE_BYTES) {
			throw new Error("Each file must be 10 MB or smaller.");
		}
	}
};

export const uploadNoteFile = async ({
	file,
	noteId,
	workspaceId,
}: {
	file: File;
	noteId: Id<"notes">;
	workspaceId: Id<"workspaces">;
}): Promise<UploadedNoteFile> => {
	const token = await getCachedConvexToken();
	if (!token) {
		throw new Error("Sign in again to upload files.");
	}

	const url = new URL("/api/note-files", getConvexSiteUrl());
	url.searchParams.set("workspaceId", workspaceId);
	url.searchParams.set("noteId", noteId);
	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": file.type || "application/octet-stream",
			"X-File-Name": encodeURIComponent(file.name),
		},
		body: file,
	});
	let payload: unknown = null;
	try {
		payload = (await response.json()) as unknown;
	} catch {
		// The status still determines the stable user-facing upload error below.
	}
	if (!response.ok) {
		const parsedError = uploadErrorSchema.safeParse(payload);
		throw new Error(
			parsedError.success ? parsedError.data.error : "File upload failed.",
		);
	}

	const parsedResult = uploadResultSchema.safeParse(payload);
	if (!parsedResult.success) {
		throw new Error("File upload returned an invalid response.");
	}
	return {
		...parsedResult.data,
		noteAttachmentId: parsedResult.data
			.noteAttachmentId as Id<"noteAttachmentReferences">,
	};
};
