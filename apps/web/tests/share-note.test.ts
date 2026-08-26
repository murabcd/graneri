// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeRichTextToClipboard } from "../src/components/note/share-note";

class ClipboardItemMock {
	constructor(readonly items: Record<string, Blob>) {}
}

describe("writeRichTextToClipboard", () => {
	const originalClipboardItem = globalThis.ClipboardItem;
	const originalExecCommand = document.execCommand;
	const originalSecureContext = window.isSecureContext;
	const originalClipboard = navigator.clipboard;
	const clipboardWrite = vi.fn();
	const clipboardWriteText = vi.fn();

	beforeEach(() => {
		clipboardWrite.mockReset().mockRejectedValue(new Error("blocked"));
		clipboardWriteText.mockReset().mockResolvedValue(undefined);
		Object.defineProperty(window, "isSecureContext", {
			configurable: true,
			value: true,
		});
		Object.defineProperty(globalThis, "ClipboardItem", {
			configurable: true,
			value: ClipboardItemMock,
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: vi.fn(() => false),
		});
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				write: clipboardWrite,
				writeText: clipboardWriteText,
			},
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		Object.defineProperty(window, "isSecureContext", {
			configurable: true,
			value: originalSecureContext,
		});
		Object.defineProperty(globalThis, "ClipboardItem", {
			configurable: true,
			value: originalClipboardItem,
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: originalExecCommand,
		});
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: originalClipboard,
		});
	});

	it("writes clean semantic HTML and Markdown clipboard flavors", async () => {
		clipboardWrite.mockResolvedValueOnce(undefined);

		await writeRichTextToClipboard({
			html: [
				"<article>",
				'<h2 id="generated-heading" data-toc-id="generated-heading">Details</h2>',
				"<ul><li><p>First item</p></li></ul>",
				"<script>alert('unsafe')</script>",
				"</article>",
			].join(""),
			text: "# Title\n\n## Details\n\n- First item",
		});

		expect(clipboardWrite).toHaveBeenCalledOnce();
		const [clipboardItem] = clipboardWrite.mock.calls[0]?.[0] ?? [];
		expect(clipboardItem).toBeInstanceOf(ClipboardItemMock);
		const { items } = clipboardItem as ClipboardItemMock;
		expect(Object.keys(items).sort()).toEqual(["text/html", "text/plain"]);
		expect(await items["text/html"]?.text()).toBe(
			"<article><h2>Details</h2><ul><li><p>First item</p></li></ul></article>",
		);
		expect(await items["text/plain"]?.text()).toBe(
			"# Title\n\n## Details\n\n- First item",
		);
		expect(document.execCommand).not.toHaveBeenCalled();
		expect(clipboardWriteText).not.toHaveBeenCalled();
	});

	it("falls back to plain text when rich clipboard writes fail", async () => {
		await writeRichTextToClipboard({
			html: "<article><h1>Title</h1><p>Body</p></article>",
			text: "Title\n\nBody",
		});

		expect(clipboardWrite).toHaveBeenCalledTimes(1);
		expect(document.execCommand).toHaveBeenCalledWith("copy");
		expect(clipboardWriteText).toHaveBeenCalledWith("Title\n\nBody");
	});
});
