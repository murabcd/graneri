import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { Tiptap, useEditor } from "@tiptap/react";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteImageMenu } from "../src/components/note/note-image-menu";
import { createNoteEditorExtensions } from "../src/lib/note-editor";

const IMAGE_DOCUMENT = {
	type: "doc",
	content: [
		{
			type: "image",
			attrs: {
				alt: "Diagram.png",
				noteImageId: "image_1",
				src: "https://example.test/diagram.png",
			},
		},
	],
};

afterEach(() => {
	cleanup();
});

function ImageMenuHarness({
	onEditor,
	onReplace,
}: {
	onEditor: (editor: Editor) => void;
	onReplace: (position: number) => void;
}) {
	const editor = useEditor({
		content: IMAGE_DOCUMENT,
		extensions: createNoteEditorExtensions(),
		immediatelyRender: false,
		onCreate: ({ editor: nextEditor }) => onEditor(nextEditor),
	});

	return editor ? (
		<TooltipProvider>
			<Tiptap editor={editor}>
				<Tiptap.Content aria-label="Note editor" />
				<NoteImageMenu onReplace={onReplace} />
			</Tiptap>
		</TooltipProvider>
	) : null;
}

function ReadOnlyImageHarness({
	onEditor,
}: {
	onEditor: (editor: Editor) => void;
}) {
	const editor = useEditor({
		content: IMAGE_DOCUMENT,
		editable: false,
		extensions: createNoteEditorExtensions(),
		immediatelyRender: false,
		onCreate: ({ editor: nextEditor }) => onEditor(nextEditor),
	});

	return editor ? (
		<Tiptap editor={editor}>
			<Tiptap.Content aria-label="Read-only note" />
		</Tiptap>
	) : null;
}

const renderImageEditor = async () => {
	let editor: Editor | null = null;
	const onReplace = vi.fn();
	render(
		<ImageMenuHarness
			onEditor={(nextEditor) => {
				editor = nextEditor;
			}}
			onReplace={onReplace}
		/>,
	);
	await waitFor(() => expect(editor).not.toBeNull());
	if (!editor) {
		throw new Error("Editor did not initialize");
	}
	return { editor, onReplace };
};

const renderImageMenu = async () => {
	const { editor, onReplace } = await renderImageEditor();
	act(() => {
		editor.commands.setNodeSelection(0);
	});
	await screen.findByRole("toolbar", { name: "Image options" });
	return { editor, onReplace };
};

describe("note image options", () => {
	it("selects an image as one node when clicked", async () => {
		const { editor } = await renderImageEditor();
		const image = screen.getByRole("img", { name: "Diagram.png" });

		expect(image.getAttribute("decoding")).toBe("async");
		expect(image.getAttribute("loading")).toBe("lazy");
		fireEvent.click(image);

		expect(editor.state.selection).toBeInstanceOf(NodeSelection);
		expect(
			document
				.querySelector("figure.note-image-node")
				?.classList.contains("ProseMirror-selectednode"),
		).toBe(true);
	});

	it("does not render resize controls in read-only note previews", async () => {
		let editor: Editor | null = null;
		render(
			<ReadOnlyImageHarness
				onEditor={(nextEditor) => {
					editor = nextEditor;
				}}
			/>,
		);

		await waitFor(() => expect(editor).not.toBeNull());
		expect(screen.getByRole("img", { name: "Diagram.png" })).not.toBeNull();
		expect(document.querySelector(".note-image-resize-handle")).toBeNull();
	});

	it("clears the image selection when pressing outside its image and menu", async () => {
		const { editor } = await renderImageMenu();

		fireEvent.pointerDown(
			screen.getByRole("toolbar", { name: "Image options" }),
		);
		expect(editor.state.selection).toBeInstanceOf(NodeSelection);

		fireEvent.pointerDown(document.body);

		expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
		await waitFor(() => {
			expect(
				screen.queryByRole("toolbar", { name: "Image options" }),
			).toBeNull();
		});
		expect(
			editor.view.dom.querySelector(
				"figure.note-image-node.ProseMirror-selectednode",
			),
		).toBeNull();
	});

	it("aligns, captions, replaces, and deletes a selected image", async () => {
		const { editor, onReplace } = await renderImageMenu();

		fireEvent.click(screen.getByRole("button", { name: "Align image center" }));
		expect(editor.getAttributes("image").align).toBe("center");
		expect(
			editor.view.dom
				.querySelector("figure.note-image-node")
				?.getAttribute("data-align"),
		).toBe("center");

		fireEvent.click(
			screen.getByRole("button", { name: "Toggle image caption" }),
		);
		const caption = screen.getByRole("textbox", { name: "Image caption" });
		expect(caption.hasAttribute("hidden")).toBe(false);
		fireEvent.input(caption, { target: { value: "Release architecture" } });
		expect(editor.getAttributes("image").caption).toBe("Release architecture");

		fireEvent.click(screen.getByRole("button", { name: "Replace image" }));
		expect(onReplace).toHaveBeenCalledWith(0);

		fireEvent.click(screen.getByRole("button", { name: "Delete image" }));
		expect(
			editor.getJSON().content?.some((node) => node.type === "image"),
		).toBe(false);
	});

	it("resizes from either image edge and persists the width", async () => {
		const { editor } = await renderImageMenu();
		const image = screen.getByRole("img", { name: "Diagram.png" });
		Object.defineProperties(image, {
			offsetWidth: {
				configurable: true,
				get: () => Number.parseFloat(image.style.width) || 400,
			},
			offsetHeight: {
				configurable: true,
				get: () => Number.parseFloat(image.style.height) || 300,
			},
		});
		const rightHandle = editor.view.dom.querySelector<HTMLElement>(
			'.note-image-resize-handle[data-resize-handle="right"]',
		);
		expect(rightHandle).not.toBeNull();
		if (!rightHandle) {
			throw new Error("Right resize handle was not rendered");
		}

		fireEvent.mouseDown(rightHandle, { clientX: 400, clientY: 300 });
		fireEvent.mouseMove(document, { clientX: 500, clientY: 300 });
		expect(image.style.width).toBe("500px");
		expect(image.style.height).toBe("");
		fireEvent.mouseUp(document);

		expect(editor.getAttributes("image")).toMatchObject({
			width: 500,
			height: null,
		});
	});
});
