import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { Tiptap, useEditor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createNoteEditorExtensions,
	EMPTY_DOCUMENT,
} from "../src/lib/note-editor";

afterEach(() => {
	cleanup();
});

function SlashCommandHarness({
	onSelectImage,
	onEditor,
}: {
	onSelectImage: () => void;
	onEditor: (editor: Editor) => void;
}) {
	const editor = useEditor({
		content: EMPTY_DOCUMENT,
		extensions: createNoteEditorExtensions({
			onSelectImageCommand: onSelectImage,
		}),
		immediatelyRender: false,
		onCreate: ({ editor }) => onEditor(editor),
	});

	return editor ? (
		<Tiptap editor={editor}>
			<Tiptap.Content aria-label="Note editor" />
		</Tiptap>
	) : null;
}

const renderSlashCommandHarness = async () => {
	const onSelectImage = vi.fn();
	let editor: Editor | null = null;
	render(
		<SlashCommandHarness
			onSelectImage={onSelectImage}
			onEditor={(nextEditor) => {
				editor = nextEditor;
			}}
		/>,
	);
	await waitFor(() => expect(editor).not.toBeNull());
	if (!editor) {
		throw new Error("Editor did not initialize");
	}
	return { editor, onSelectImage };
};

const openSlashCommands = (editor: Editor, query = "") => {
	act(() => {
		editor.chain().focus().insertContent(`/${query}`).run();
	});
};

const selectActiveSlashCommand = (editor: Editor) => {
	fireEvent.keyDown(editor.view.dom, { key: "Enter" });
};

describe("note slash command", () => {
	it("groups note block styles and insert actions", async () => {
		const { editor } = await renderSlashCommandHarness();
		openSlashCommands(editor);

		const commandList = await screen.findByRole("listbox", {
			name: "Note commands",
		});
		expect(
			commandList.classList.contains("w-[min(14rem,calc(100vw-1rem))]"),
		).toBe(true);
		expect(screen.getByText("Style")).toBeTruthy();
		expect(screen.getByText("Insert")).toBeTruthy();
		expect(screen.getByText("Upload")).toBeTruthy();
		for (const name of [
			"Text",
			"Heading 1",
			"Heading 2",
			"Heading 3",
			"Bullet list",
			"Numbered list",
			"To-do list",
			"Blockquote",
			"Code block",
			"Table",
			"Separator",
			"Image",
		]) {
			expect(screen.getByRole("option", { name })).toBeTruthy();
		}
		const textOption = screen.getByRole("option", { name: "Text" });
		expect(textOption.classList.contains("h-8")).toBe(true);
		const textIcon = textOption.querySelector(
			'[data-slot="note-slash-command-icon"]',
		);
		expect(textIcon?.parentElement).toBe(textOption);
		expect(
			textOption.querySelector('[data-slot="note-slash-command-check"]'),
		).toBeNull();
		const insertGroup = screen.getByRole("group", { name: "Insert" });
		const uploadGroup = screen.getByRole("group", { name: "Upload" });
		expect(
			within(uploadGroup).getByRole("option", { name: "Image" }),
		).toBeTruthy();
		expect(
			within(insertGroup).queryByRole("option", { name: "Image" }),
		).toBeNull();
		expect(commandList.querySelector(".border-t")).toBeNull();
		fireEvent.keyDown(editor.view.dom, { key: "Escape" });
	});

	it("opens the image command with slash and selects it with Enter", async () => {
		const { editor, onSelectImage } = await renderSlashCommandHarness();
		openSlashCommands(editor, "im");
		expect(
			await screen.findByRole("listbox", { name: "Note commands" }),
		).toBeTruthy();
		expect(screen.getByRole("option", { name: /Image/ })).toBeTruthy();
		expect(screen.queryByText("Upload from your device")).toBeNull();

		selectActiveSlashCommand(editor);

		expect(onSelectImage).toHaveBeenCalledOnce();
		expect(editor.getText()).toBe("");
	});

	it("applies a heading style from its search alias", async () => {
		const { editor } = await renderSlashCommandHarness();
		openSlashCommands(editor, "h2");
		expect(
			await screen.findByRole("option", { name: "Heading 2" }),
		).toBeTruthy();

		selectActiveSlashCommand(editor);

		expect(editor.getJSON().content?.[0]).toMatchObject({
			type: "heading",
			attrs: { level: 2 },
		});
	});

	it("opens after existing paragraph text separated by whitespace", async () => {
		const { editor } = await renderSlashCommandHarness();
		act(() => {
			editor.commands.setContent("<p>Existing text</p>");
			editor
				.chain()
				.setTextSelection(editor.state.doc.content.size - 1)
				.insertContent(" /h2")
				.run();
		});

		expect(
			await screen.findByRole("option", { name: "Heading 2" }),
		).toBeTruthy();
		selectActiveSlashCommand(editor);

		expect(editor.getJSON().content?.[0]).toMatchObject({
			type: "heading",
			attrs: { level: 2 },
			content: [{ type: "text", text: "Existing text " }],
		});
	});

	it("inserts a three-column Tiptap table", async () => {
		const { editor } = await renderSlashCommandHarness();
		openSlashCommands(editor, "table");
		const tableOption = await screen.findByRole("option", { name: "Table" });
		expect(tableOption.getAttribute("aria-haspopup")).toBeNull();
		fireEvent.mouseEnter(tableOption);
		expect(screen.queryByRole("group", { name: "Table size" })).toBeNull();

		selectActiveSlashCommand(editor);

		const table = editor.getJSON().content?.[0];
		expect(table?.type).toBe("table");
		expect(table?.content).toHaveLength(3);
		expect(table?.content?.[0]?.content).toHaveLength(3);
		expect(table?.content?.[0]?.content?.[0]?.type).toBe("tableCell");
	});

	it("inserts the StarterKit separator", async () => {
		const { editor } = await renderSlashCommandHarness();
		openSlashCommands(editor, "separator");
		expect(
			await screen.findByRole("option", { name: "Separator" }),
		).toBeTruthy();

		selectActiveSlashCommand(editor);

		expect(editor.getJSON().content?.[0]?.type).toBe("horizontalRule");
	});
});
