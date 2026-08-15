import { Editor, getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
	createNoteEditorExtensions,
	EMPTY_DOCUMENT,
	looksLikeMarkdown,
	normalizePastedPlainText,
	parseStoredNoteContent,
	serializeDocumentToMarkdown,
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

	it("parses markdown note content into tiptap json", () => {
		const parsed = parseStoredNoteContent(
			"# Summary\n\n- shipped ~~markdown~~\n- kept autosave\n\n```ts\nconst ready = true\n```",
			schema,
		);

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

	it("keeps uploaded Convex images and rejects unowned image nodes", () => {
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
			content: [
				uploadedImage,
				{
					type: "image",
					attrs: { src: "https://untrusted.test/hotlink.png" },
				},
			],
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

	it("does not turn remote markdown images into note attachments", () => {
		const parsed = parseStoredNoteContent(
			"Before\n\n![remote](https://example.test/image.png)\n\nAfter",
			schema,
		);

		expect(parsed.content?.some((node) => node.type === "image")).toBe(false);
	});

	it("upgrades legacy bold-paragraph section titles into headings", () => {
		const parsed = parseStoredNoteContent(
			JSON.stringify({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{
								type: "text",
								text: "Context",
								marks: [{ type: "bold" }],
							},
						],
					},
					{
						type: "bulletList",
						content: [
							{
								type: "listItem",
								content: [
									{
										type: "paragraph",
										content: [{ type: "text", text: "First item" }],
									},
								],
							},
						],
					},
				],
			}),
			schema,
		);

		expect(parsed.content?.[0]).toMatchObject({
			type: "heading",
			attrs: { level: 2 },
			content: [{ type: "text", text: "Context" }],
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
