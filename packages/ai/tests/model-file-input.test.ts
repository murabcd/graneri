import { describe, expect, it } from "vitest";
import {
	assertModelFileMedia,
	detectModelFileMedia,
	isModelFilePartMediaType,
} from "../src/model-file-input.mjs";
import { createOpenXmlBytes } from "./model-file-fixtures";

describe("model file input", () => {
	it.each([
		[
			"docx",
			"word/document.xml",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		],
		[
			"xlsx",
			"xl/workbook.xml",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		],
		[
			"pptx",
			"ppt/presentation.xml",
			"application/vnd.openxmlformats-officedocument.presentationml.presentation",
		],
	] as const)("detects %s from OOXML package contents", (format, entry, mediaType) => {
		expect(
			detectModelFileMedia(createOpenXmlBytes(["[Content_Types].xml", entry])),
		).toEqual({ format, kind: "document", mediaType });
	});

	it("detects PDF from its signature", () => {
		expect(
			detectModelFileMedia(new TextEncoder().encode("%PDF-1.7\n")),
		).toEqual({
			format: "pdf",
			kind: "document",
			mediaType: "application/pdf",
		});
	});

	it("rejects generic ZIP and binary inputs", () => {
		expect(() =>
			assertModelFileMedia(createOpenXmlBytes(["notes.txt"])),
		).toThrow("Unsupported file format");
		expect(() => assertModelFileMedia(new Uint8Array([0, 1, 2]))).toThrow(
			"Unsupported file format",
		);
	});

	it("keeps the model file-part media allowlist exact", () => {
		expect(isModelFilePartMediaType("application/pdf")).toBe(true);
		expect(isModelFilePartMediaType("image/png")).toBe(true);
		expect(isModelFilePartMediaType("image/svg+xml")).toBe(false);
	});
});
