import { describe, expect, test } from "vitest";
import { parseNoteDocument } from "./noteDocument";

describe("canonical note documents", () => {
	test("parses once and derives image references and comment anchors", () => {
		const content = JSON.stringify({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "Review this",
							marks: [
								{
									type: "noteComment",
									attrs: { threadId: "thread-1" },
								},
							],
						},
					],
				},
				{
					type: "image",
					attrs: {
						noteImageId: "image-1",
						src: "https://storage.test/image.png",
					},
				},
			],
		});

		const parsed = parseNoteDocument(content);
		expect(JSON.parse(parsed.content)).toEqual(JSON.parse(content));
		expect(parsed).toMatchObject({
			images: [
				{
					noteImageId: "image-1",
					src: "https://storage.test/image.png",
				},
			],
			commentAnchors: [
				{
					threadId: "thread-1",
					excerpt: "Review this",
				},
			],
		});
	});

	test("derives durable file references from canonical note file nodes", () => {
		const parsed = parseNoteDocument(
			JSON.stringify({
				type: "doc",
				content: [
					{
						type: "noteFile",
						attrs: {
							noteAttachmentId: "attachment-1",
							filename: "report.docx",
							mediaType:
								"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
							sizeBytes: 128,
						},
					},
					{ type: "paragraph" },
				],
			}),
		);

		expect(parsed.attachments).toEqual([
			{
				noteAttachmentId: "attachment-1",
				filename: "report.docx",
				mediaType:
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				sizeBytes: 128,
			},
		]);
	});

	test("rejects note file nodes without complete storage metadata", () => {
		expect(() =>
			parseNoteDocument(
				JSON.stringify({
					type: "doc",
					content: [
						{
							type: "noteFile",
							attrs: {
								filename: "report.docx",
								mediaType: "application/octet-stream",
								sizeBytes: 128,
							},
						},
					],
				}),
			),
		).toThrow("identify an uploaded attachment");
	});

	test("rejects malformed and non-document content", () => {
		expect(() => parseNoteDocument("legacy markdown")).toThrow(
			"valid Tiptap JSON",
		);
		expect(() =>
			parseNoteDocument(JSON.stringify({ type: "paragraph" })),
		).toThrow("must be a Tiptap document");
		expect(() =>
			parseNoteDocument(
				JSON.stringify({
					type: "doc",
					content: [{ type: "unsupportedWidget" }],
				}),
			),
		).toThrow("doc must contain note blocks");
	});

	test("rejects structurally invalid tables", () => {
		expect(() =>
			parseNoteDocument(
				JSON.stringify({
					type: "doc",
					content: [
						{
							type: "table",
							content: [
								{
									type: "tableRow",
									content: [{ type: "tableCell" }, { type: "tableCell" }],
								},
								{
									type: "tableRow",
									content: [{ type: "tableCell" }],
								},
							],
						},
					],
				}),
			),
		).toThrow("same width");
	});
});
