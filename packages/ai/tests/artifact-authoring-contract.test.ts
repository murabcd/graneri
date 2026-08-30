import { describe, expect, it } from "vitest";
import {
	artifactAuthoringInputSchema,
	parseArtifactToolOutput,
} from "../src/artifact-authoring-contract.mjs";
import { shouldEnableArtifactAuthoring } from "../src/artifact-authoring-tool.mjs";

describe("artifact authoring contract", () => {
	it("detects file-first edit wording and office attachments", () => {
		expect(
			shouldEnableArtifactAuthoring({
				id: "message-1",
				role: "user",
				parts: [{ type: "text", text: "In this DOCX, add a final line" }],
			}),
		).toBe(true);
		expect(
			shouldEnableArtifactAuthoring({
				id: "message-2",
				role: "user",
				parts: [
					{ type: "text", text: "Add a final line" },
					{
						type: "file",
						filename: "report.docx",
						mediaType:
							"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
						url: "https://files.example/report.docx",
					},
				],
			}),
		).toBe(true);
		expect(
			shouldEnableArtifactAuthoring({
				id: "message-3",
				role: "user",
				parts: [{ type: "text", text: "Write a launch brief as a DOCX" }],
			}),
		).toBe(true);
	});
	it("normalizes a bounded document request at the model boundary", () => {
		expect(
			artifactAuthoringInputSchema.parse({
				kind: "document_create",
				document: {
					title: "Launch brief",
					blocks: [{ type: "paragraph", text: "Ready for review." }],
				},
				outputs: [{ filename: "launch-brief.docx", format: "docx" }],
			}),
		).toMatchObject({
			document: { orientation: "portrait", pageSize: "a4" },
		});
	});

	it("rejects an edit without a durable source reference", () => {
		expect(() =>
			artifactAuthoringInputSchema.parse({
				kind: "pdf_edit",
				filename: "edited.pdf",
				edits: [{ type: "delete_pages", pageNumbers: [1] }],
			}),
		).toThrow();
	});

	it("rejects document tables that would silently truncate cells", () => {
		expect(() =>
			artifactAuthoringInputSchema.parse({
				kind: "document_create",
				document: {
					title: "Report",
					blocks: [
						{
							type: "table",
							headers: ["Month"],
							rows: [["January", "1200"]],
						},
					],
				},
				outputs: [{ filename: "report.docx", format: "docx" }],
			}),
		).toThrow("Document table rows must match the header width");
	});

	it("supports an explicit DOCX-to-PDF export without a fake edit", () => {
		expect(
			artifactAuthoringInputSchema.parse({
				kind: "document_export",
				source: {
					filename: "report.docx",
					mediaType:
						"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					storageId: "storage-report",
				},
				outputs: [{ filename: "report.pdf", format: "pdf" }],
			}),
		).toMatchObject({ kind: "document_export" });
	});

	it("rejects artifact requests that exceed safe authoring bounds", () => {
		expect(() =>
			artifactAuthoringInputSchema.parse({
				filename: "oversized.xlsx",
				kind: "spreadsheet_create",
				sheets: [
					{
						name: "Data",
						rows: Array.from({ length: 2_501 }, () =>
							Array.from({ length: 100 }, () => null),
						),
					},
				],
			}),
		).toThrow("Spreadsheet creation exceeds the 250,000-cell limit");

		expect(() =>
			artifactAuthoringInputSchema.parse({
				filename: "overflow.pptx",
				kind: "presentation_create",
				presentation: {
					slides: [
						{
							bullets: Array.from(
								{ length: 9 },
								(_, index) => `Bullet ${index + 1}`,
							),
							layout: "content",
							title: "Too many bullets",
						},
					],
					title: "Overflow",
				},
			}),
		).toThrow();

		const insertedSlides = Array.from({ length: 60 }, (_, index) => ({
			layout: "section" as const,
			title: `Section ${index + 1}`,
		}));
		expect(() =>
			artifactAuthoringInputSchema.parse({
				edits: [
					{ afterSlide: 0, slides: insertedSlides, type: "insert_slides" },
					{ afterSlide: 60, slides: insertedSlides, type: "insert_slides" },
				],
				filename: "overflow.pptx",
				kind: "presentation_edit",
				source: {
					filename: "source.pptx",
					mediaType:
						"application/vnd.openxmlformats-officedocument.presentationml.presentation",
					storageId: "storage-presentation",
				},
			}),
		).toThrow("Presentation edits exceed the 100-slide insertion limit");
	});

	it("parses multiple independently downloadable outputs", () => {
		const output = parseArtifactToolOutput({
			artifacts: ["docx", "pdf"].map((format) => ({
				filename: `report.${format}`,
				mediaType:
					format === "pdf"
						? "application/pdf"
						: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				providerMetadata: {
					graneri: { generatedBy: "ai", storageId: `storage-${format}` },
				},
				sizeBytes: 100,
				url: `https://files.example/${format}`,
			})),
		});
		expect(output?.artifacts.map((artifact) => artifact.filename)).toEqual([
			"report.docx",
			"report.pdf",
		]);
	});

	it("enables creation and editing language without matching ordinary chat", () => {
		expect(
			shouldEnableArtifactAuthoring({
				id: "message-1",
				role: "user",
				parts: [{ type: "text", text: "Add a new row to this Excel file" }],
			}),
		).toBe(true);
		expect(
			shouldEnableArtifactAuthoring({
				id: "message-2",
				role: "user",
				parts: [{ type: "text", text: "Tell me about spreadsheets" }],
			}),
		).toBe(false);
	});
});
