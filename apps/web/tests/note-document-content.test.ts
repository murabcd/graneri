import { describe, expect, it } from "vitest";
import {
	getExportFileName,
	getRichTextContent,
} from "../src/lib/note-document-content";

type NoteContentEditor = Parameters<typeof getRichTextContent>[0]["editor"];

const createEditor = ({ html, markdown }: { html: string; markdown: string }) =>
	({
		getHTML: () => html,
		getMarkdown: () => markdown,
		getText: () => "",
	}) satisfies NoteContentEditor;

describe("note document content", () => {
	it("adds exactly one Markdown extension to export filenames", () => {
		expect(getExportFileName("WhatsApp API Stone")).toBe(
			"whatsapp-api-stone.md",
		);
		expect(getExportFileName("whatsapp-api-stone.md")).toBe(
			"whatsapp-api-stone.md",
		);
		expect(getExportFileName("Meeting notes.MD")).toBe("meeting-notes.md");
	});

	it("pairs semantic HTML with readable Markdown plain text", () => {
		const html = [
			"<blockquote><p>Summary</p></blockquote>",
			'<h2 id="details" data-toc-id="details">Details</h2>',
			"<ul><li><p>First item</p></li><li><p>Second item</p></li></ul>",
		].join("");
		const markdown = [
			"> Summary",
			"",
			"## Details",
			"",
			"- First item",
			"- Second item",
		].join("\n");

		expect(
			getRichTextContent({
				editor: createEditor({ html, markdown }),
				searchableText: "unused fallback",
				title: "Voice capture",
			}),
		).toEqual({
			html: `<article><h1>Voice capture</h1>${html}</article>`,
			text: `# Voice capture\n\n${markdown}`,
		});
	});

	it("uses searchable text when the editor is empty", () => {
		expect(
			getRichTextContent({
				editor: createEditor({ html: "<p></p>", markdown: "" }),
				searchableText: "First paragraph\n\nSecond paragraph",
				title: "",
			}),
		).toEqual({
			html: "<article><p>First paragraph</p><p>Second paragraph</p></article>",
			text: "First paragraph\n\nSecond paragraph",
		});
	});
});
