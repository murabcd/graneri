import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
	createNoteEditorExtensions,
	EMPTY_DOCUMENT,
} from "../src/lib/note-editor";
import { trackNoteUploadPosition } from "../src/lib/note-upload-position";

describe("note upload insertion position", () => {
	it("maps the requested position through edits made while an upload is running", () => {
		const editor = new Editor({
			content: EMPTY_DOCUMENT,
			extensions: createNoteEditorExtensions(),
		});
		editor.commands.setContent("<p>Existing text</p>");
		const initialPosition = editor.state.doc.content.size;
		const trackedPosition = trackNoteUploadPosition(editor, initialPosition);

		editor.commands.insertContentAt(1, "Prefix ");

		expect(trackedPosition.read()).toBe(initialPosition + "Prefix ".length);
		trackedPosition.stop();
		editor.destroy();
	});
});
