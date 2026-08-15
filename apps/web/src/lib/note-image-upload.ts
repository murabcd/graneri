import { z } from "zod";
import type { Id } from "../../../../convex/_generated/dataModel";
import { getCachedConvexToken } from "./convex-token";
import { getConvexSiteUrl } from "./runtime-config";

export const NOTE_IMAGE_MIME_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
] as const;
type NoteImageMimeType = (typeof NOTE_IMAGE_MIME_TYPES)[number];

const isNoteImageMimeType = (value: string): value is NoteImageMimeType =>
	NOTE_IMAGE_MIME_TYPES.some((mimeType) => mimeType === value);

export const NOTE_IMAGE_ACCEPT = NOTE_IMAGE_MIME_TYPES.join(",");
export const MAX_NOTE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_NOTE_IMAGE_UPLOAD_BATCH = 10;

const uploadResultSchema = z.object({
	noteImageId: z.string(),
	url: z.url(),
});

const uploadErrorSchema = z.object({ error: z.string() });

export type UploadedNoteImage = {
	noteImageId: Id<"noteImages">;
	url: string;
	fileName: string;
};

export const validateNoteImageFiles = (files: File[]) => {
	if (files.length > MAX_NOTE_IMAGE_UPLOAD_BATCH) {
		throw new Error(
			`Upload no more than ${MAX_NOTE_IMAGE_UPLOAD_BATCH} images at once.`,
		);
	}

	for (const file of files) {
		if (!isNoteImageMimeType(file.type)) {
			throw new Error("Use a JPEG, PNG, WebP, or GIF image.");
		}
		if (file.size > MAX_NOTE_IMAGE_BYTES) {
			throw new Error("Each image must be 10 MB or smaller.");
		}
		if (file.size === 0) {
			throw new Error("The image file is empty.");
		}
	}
};

export const uploadNoteImage = async ({
	file,
	noteId,
	workspaceId,
}: {
	file: File;
	noteId: Id<"notes">;
	workspaceId: Id<"workspaces">;
}): Promise<UploadedNoteImage> => {
	const token = await getCachedConvexToken();
	if (!token) {
		throw new Error("Sign in again to upload images.");
	}

	const url = new URL("/api/note-images", getConvexSiteUrl());
	url.searchParams.set("workspaceId", workspaceId);
	url.searchParams.set("noteId", noteId);
	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": file.type,
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
			parsedError.success ? parsedError.data.error : "Image upload failed.",
		);
	}

	const parsedResult = uploadResultSchema.safeParse(payload);
	if (!parsedResult.success) {
		throw new Error("Image upload returned an invalid response.");
	}
	const result = parsedResult.data;
	return {
		noteImageId: result.noteImageId as Id<"noteImages">,
		url: result.url,
		fileName: file.name,
	};
};
