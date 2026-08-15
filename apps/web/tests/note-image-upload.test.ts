import { describe, expect, it } from "vitest";
import {
	MAX_NOTE_IMAGE_BYTES,
	MAX_NOTE_IMAGE_UPLOAD_BATCH,
	validateNoteImageFiles,
} from "../src/lib/note-image-upload";

const createImageFile = ({
	size = 1,
	type = "image/png",
}: {
	size?: number;
	type?: string;
} = {}) =>
	new File([new Uint8Array(size)], "diagram.png", {
		type,
	});

describe("note image upload validation", () => {
	it("accepts the supported image formats", () => {
		for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
			expect(() =>
				validateNoteImageFiles([createImageFile({ type })]),
			).not.toThrow();
		}
	});

	it("rejects unsupported and empty files", () => {
		expect(() =>
			validateNoteImageFiles([createImageFile({ type: "image/svg+xml" })]),
		).toThrow("Use a JPEG, PNG, WebP, or GIF image.");
		expect(() =>
			validateNoteImageFiles([createImageFile({ size: 0 })]),
		).toThrow("The image file is empty.");
	});

	it("rejects oversized files and oversized batches", () => {
		expect(() =>
			validateNoteImageFiles([
				createImageFile({ size: MAX_NOTE_IMAGE_BYTES + 1 }),
			]),
		).toThrow("Each image must be 10 MB or smaller.");
		expect(() =>
			validateNoteImageFiles(
				Array.from({ length: MAX_NOTE_IMAGE_UPLOAD_BATCH + 1 }, () =>
					createImageFile(),
				),
			),
		).toThrow(
			`Upload no more than ${MAX_NOTE_IMAGE_UPLOAD_BATCH} images at once.`,
		);
	});
});
