import { describe, expect, it } from "vitest";
import {
	MAX_NOTE_FILE_BYTES,
	MAX_NOTE_FILE_UPLOAD_BATCH,
	validateNoteFileSelection,
} from "../src/lib/note-file-upload";

const createFile = (size = 1) =>
	new File([new Uint8Array(size)], "report.pdf", {
		type: "application/pdf",
	});

describe("note file upload selection", () => {
	it("accepts a non-empty file within the note limit", () => {
		expect(() => validateNoteFileSelection([createFile()])).not.toThrow();
	});

	it("rejects empty and oversized files", () => {
		expect(() => validateNoteFileSelection([createFile(0)])).toThrow(
			"The file is empty.",
		);
		expect(() =>
			validateNoteFileSelection([createFile(MAX_NOTE_FILE_BYTES + 1)]),
		).toThrow("Each file must be 10 MB or smaller.");
	});

	it("rejects batches beyond the bounded upload count", () => {
		expect(() =>
			validateNoteFileSelection(
				Array.from({ length: MAX_NOTE_FILE_UPLOAD_BATCH + 1 }, () =>
					createFile(),
				),
			),
		).toThrow(
			`Upload no more than ${MAX_NOTE_FILE_UPLOAD_BATCH} files at once.`,
		);
	});
});
