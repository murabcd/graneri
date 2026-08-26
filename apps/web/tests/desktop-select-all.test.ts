import { afterEach, describe, expect, it } from "vitest";
import { selectAllInActiveEditable } from "@/lib/desktop-select-all";

const selectDocumentBody = () => {
	const selection = window.getSelection();
	const range = document.createRange();
	range.selectNodeContents(document.body);
	selection?.removeAllRanges();
	selection?.addRange(range);
};

afterEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

describe("desktop Select All", () => {
	it("clears a page-wide selection when no editable control is focused", () => {
		const chrome = document.createElement("p");
		chrome.textContent = "Home Settings Notes";
		document.body.append(chrome);
		document.body.tabIndex = -1;
		document.body.focus();
		selectDocumentBody();

		selectAllInActiveEditable(document);

		expect(window.getSelection()?.rangeCount).toBe(0);
	});

	it("selects only the focused text input value", () => {
		const input = document.createElement("input");
		input.value = "Murad Abdulkadyrov";
		document.body.append(input);
		input.focus();
		selectDocumentBody();

		selectAllInActiveEditable(document);

		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe(input.value.length);
		expect(window.getSelection()?.rangeCount).toBe(0);
	});

	it("selects only the focused textarea value", () => {
		const textarea = document.createElement("textarea");
		textarea.value = "Ask anything";
		document.body.append(textarea);
		textarea.focus();

		selectAllInActiveEditable(document);

		expect(textarea.selectionStart).toBe(0);
		expect(textarea.selectionEnd).toBe(textarea.value.length);
	});

	it("contains a contenteditable selection within its editor", () => {
		const chrome = document.createElement("p");
		chrome.textContent = "Note toolbar";
		const editor = document.createElement("div");
		editor.setAttribute("contenteditable", "true");
		editor.tabIndex = 0;
		editor.textContent = "Editable note body";
		document.body.append(chrome, editor);
		editor.focus();
		selectDocumentBody();

		selectAllInActiveEditable(document);

		const selection = window.getSelection();
		expect(selection?.toString()).toBe("Editable note body");
		expect(selection?.rangeCount).toBe(1);
		expect(
			editor.contains(selection?.getRangeAt(0).commonAncestorContainer ?? null),
		).toBe(true);
	});
});
