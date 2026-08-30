import { Editor, getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
	createNoteEditorExtensions,
	EMPTY_DOCUMENT,
	looksLikeMarkdown,
	normalizePastedPlainText,
	parseMarkdownToDocument,
	parseStoredNoteContent,
	serializeDocumentToMarkdown,
	serializeMarkdownToNoteContent,
} from "../src/lib/note-editor";

const schema = getSchema(createNoteEditorExtensions());

describe("note editor markdown bridge", () => {
	it("shows the slash-command hint in an empty editor", () => {
		const editor = new Editor({
			content: EMPTY_DOCUMENT,
			extensions: createNoteEditorExtensions(),
		});

		expect(
			editor.view.dom
				.querySelector("p.is-editor-empty")
				?.getAttribute("data-placeholder"),
		).toBe("Press / for commands");
		editor.destroy();
	});

	it("parses explicitly imported markdown into tiptap json", () => {
		const parsed = parseMarkdownToDocument(
			"# Summary\n\n- shipped ~~markdown~~\n- kept autosave\n\n```ts\nconst ready = true\n```",
			schema,
		).toJSON();

		expect(parsed).toMatchObject({
			type: "doc",
			content: [
				{
					type: "heading",
					attrs: { level: 1 },
				},
				{
					type: "bulletList",
				},
				{
					type: "codeBlock",
					attrs: { language: "ts" },
				},
			],
		});

		expect(
			parsed.content?.[1]?.content?.[0]?.content?.[0]?.content?.[1]?.marks,
		).toEqual([{ type: "strike" }]);
	});

	it("keeps stored tiptap json content unchanged", () => {
		const document = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Existing note" }],
				},
			],
		};

		expect(parseStoredNoteContent(JSON.stringify(document), schema)).toEqual(
			document,
		);
	});

	it("keeps uploaded Convex images in canonical stored documents", () => {
		const uploadedImage = {
			type: "image",
			attrs: {
				noteImageId: "image_1",
				src: "https://example.test/image.png",
				alt: "Diagram",
			},
		};
		const document = {
			type: "doc",
			content: [uploadedImage],
		};

		expect(parseStoredNoteContent(JSON.stringify(document), schema)).toEqual({
			type: "doc",
			content: [
				{
					...uploadedImage,
					attrs: expect.objectContaining(uploadedImage.attrs),
				},
			],
		});
	});

	it("keeps note files in the document flow with a writable paragraph after them", () => {
		const editor = new Editor({
			content: EMPTY_DOCUMENT,
			extensions: createNoteEditorExtensions(),
		});
		editor.commands.setContent({
			type: "doc",
			content: [
				{
					type: "noteFile",
					attrs: {
						noteAttachmentId: "attachment_1",
						filename: "report.docx",
						mediaType:
							"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
						sizeBytes: 128,
					},
				},
			],
		});

		expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
			"noteFile",
			"paragraph",
		]);
		editor.commands.focus("end");
		editor.commands.insertContent("Written below the file");
		expect(editor.getJSON().content?.at(-1)).toMatchObject({
			type: "paragraph",
			content: [{ type: "text", text: "Written below the file" }],
		});
		editor.destroy();
	});

	it("rejects non-canonical stored content instead of repairing it", () => {
		expect(() => parseStoredNoteContent("# Legacy markdown", schema)).toThrow();
		expect(() =>
			parseStoredNoteContent(
				JSON.stringify({
					type: "doc",
					content: [
						{
							type: "image",
							attrs: { src: "https://untrusted.test/hotlink.png" },
						},
					],
				}),
				schema,
			),
		).toThrow("must identify an uploaded image");
	});

	it("does not turn remote markdown images into note attachments", () => {
		const parsed = parseMarkdownToDocument(
			"Before\n\n![remote](https://example.test/image.png)\n\nAfter",
			schema,
		).toJSON();

		expect(parsed.content?.some((node) => node.type === "image")).toBe(false);
	});

	it("normalizes imported bold section titles into headings", () => {
		const parsed = parseMarkdownToDocument(
			"**Context**\n\n- First item",
			schema,
		).toJSON();

		expect(parsed.content?.[0]).toMatchObject({
			type: "heading",
			attrs: { level: 2 },
			content: [{ type: "text", text: "Context" }],
		});
	});

	it("serializes chat markdown into canonical stored content", () => {
		const storedContent = serializeMarkdownToNoteContent("## Result\n\n- Done");

		expect(parseStoredNoteContent(storedContent, schema)).toMatchObject({
			type: "doc",
			content: [
				{ type: "heading", attrs: { level: 2 } },
				{ type: "bulletList" },
			],
		});
	});

	it("does not promote nested list paragraphs into headings", () => {
		const parsed = parseStoredNoteContent(
			JSON.stringify({
				type: "doc",
				content: [
					{
						type: "bulletList",
						content: [
							{
								type: "listItem",
								content: [
									{
										type: "paragraph",
										content: [{ type: "text", text: "Parent item" }],
									},
									{
										type: "bulletList",
										content: [
											{
												type: "listItem",
												content: [
													{
														type: "paragraph",
														content: [{ type: "text", text: "Nested item" }],
													},
												],
											},
										],
									},
								],
							},
						],
					},
				],
			}),
			schema,
		);

		expect(parsed.content?.[0]?.type).toBe("bulletList");
		expect(parsed.content?.[0]?.content?.[0]?.content?.[0]).toMatchObject({
			type: "paragraph",
			content: [{ type: "text", text: "Parent item" }],
		});
	});

	it("serializes tiptap documents back to markdown", () => {
		const document = schema.nodeFromJSON({
			type: "doc",
			content: [
				{
					type: "heading",
					attrs: { level: 2 },
					content: [{ type: "text", text: "Release notes" }],
				},
				{
					type: "orderedList",
					attrs: { start: 3 },
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [
										{ type: "text", text: "Ship " },
										{
											type: "text",
											text: "markdown",
											marks: [{ type: "strike" }],
										},
									],
								},
							],
						},
					],
				},
			],
		});

		expect(serializeDocumentToMarkdown(document, schema)).toBe(
			"## Release notes\n\n3. Ship ~~markdown~~",
		);
	});

	it("detects markdown-like paste content", () => {
		expect(looksLikeMarkdown("- first item\n- second item")).toBe(true);
		expect(looksLikeMarkdown("Plain note sentence with no formatting")).toBe(
			false,
		);
	});

	it("normalizes rich-looking plain text before markdown parsing", () => {
		expect(
			normalizePastedPlainText(
				"Context product\n• First point\n• Second point",
			),
		).toBe("## Context product\n- First point\n- Second point");
	});
});
