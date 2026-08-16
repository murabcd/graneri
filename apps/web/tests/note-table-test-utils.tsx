import { render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { cellAround } from "@tiptap/pm/tables";
import { Tiptap, useEditor } from "@tiptap/react";
import { expect } from "vitest";
import { NoteTableMenu } from "../src/components/note/note-table-menu";
import { createNoteEditorExtensions } from "../src/lib/note-editor";

export const TABLE_DRAG_STEP_PX = 48;

const createTableRow = (
	cellType: "tableCell" | "tableHeader",
	rowLabel: string,
) => ({
	type: "tableRow",
	content: Array.from({ length: 3 }, (_, columnIndex) => ({
		type: cellType,
		content: [
			{
				type: "paragraph",
				content: [{ type: "text", text: `${rowLabel}-${columnIndex + 1}` }],
			},
		],
	})),
});

const TABLE_DOCUMENT = {
	type: "doc",
	content: [
		{
			type: "table",
			content: [
				createTableRow("tableCell", "first"),
				createTableRow("tableCell", "second"),
				createTableRow("tableCell", "third"),
			],
		},
	],
};

const originalElementFromPoint = Object.getOwnPropertyDescriptor(
	document,
	"elementFromPoint",
);

export const restoreElementFromPoint = () => {
	if (originalElementFromPoint) {
		Object.defineProperty(
			document,
			"elementFromPoint",
			originalElementFromPoint,
		);
		return;
	}
	Reflect.deleteProperty(document, "elementFromPoint");
};

export const mockElementFromPoint = (element: Element) => {
	Object.defineProperty(document, "elementFromPoint", {
		configurable: true,
		value: () => element,
	});
};

export const createRect = (width: number, height: number): DOMRect => ({
	bottom: height,
	height,
	left: 0,
	right: width,
	top: 0,
	width,
	x: 0,
	y: 0,
	toJSON: () => ({}),
});

function TableHarness({
	editable = true,
	onEditor,
}: {
	editable?: boolean;
	onEditor: (editor: Editor) => void;
}) {
	const editor = useEditor({
		content: TABLE_DOCUMENT,
		editable,
		extensions: createNoteEditorExtensions(),
		immediatelyRender: false,
		onCreate: ({ editor: nextEditor }) => onEditor(nextEditor),
	});

	return editor ? (
		<Tiptap editor={editor}>
			<Tiptap.Content
				aria-label={editable ? "Note editor" : "Read-only note"}
			/>
			{editable ? <NoteTableMenu /> : null}
		</Tiptap>
	) : null;
}

export const renderTable = async (editable = true) => {
	let editor: Editor | null = null;
	render(
		<TableHarness
			editable={editable}
			onEditor={(nextEditor) => {
				editor = nextEditor;
			}}
		/>,
	);
	await waitFor(() => expect(editor).not.toBeNull());
	if (!editor) {
		throw new Error("Editor did not initialize");
	}
	return editor;
};

export const getTableDimensions = (editor: Editor) => {
	const table = editor.getJSON().content?.[0];
	const firstRow = table?.content?.[0];
	if (table?.type !== "table" || !table.content || !firstRow?.content) {
		throw new Error("Table document did not render");
	}
	return {
		columns: firstRow.content.length,
		rows: table.content.length,
	};
};

export const setEdgeDragGeometry = (
	editor: Editor,
	{
		rowHeight = TABLE_DRAG_STEP_PX,
		tableWidth = TABLE_DRAG_STEP_PX * 3,
	}: { rowHeight?: number; tableWidth?: number } = {},
) => {
	const table = editor.view.dom.querySelector("table");
	if (!(table instanceof HTMLTableElement)) {
		throw new Error("Table did not render");
	}
	table.getBoundingClientRect = () =>
		createRect(tableWidth, rowHeight * table.rows.length);
	const lastRow = table.rows.item(table.rows.length - 1);
	if (!lastRow) {
		throw new Error("Table row did not render");
	}
	lastRow.getBoundingClientRect = () => createRect(tableWidth, rowHeight);
	return table;
};

export const setRenderedColumnWidths = (editor: Editor, widths: number[]) => {
	const firstRow = editor.view.dom.querySelector("tr");
	if (!(firstRow instanceof HTMLTableRowElement)) {
		throw new Error("Table row did not render");
	}
	const cells = Array.from(firstRow.cells);
	if (cells.length !== widths.length) {
		throw new Error("Rendered column widths do not match the table");
	}
	for (const [index, cell] of cells.entries()) {
		const width = widths[index];
		if (width === undefined) {
			throw new Error("Rendered column width is missing");
		}
		cell.getBoundingClientRect = () => createRect(width, TABLE_DRAG_STEP_PX);
	}
};

export const getCellPosition = (editor: Editor, cell: Element) => {
	const $cell = cellAround(
		editor.state.doc.resolve(editor.view.posAtDOM(cell, 0)),
	);
	if (!$cell) {
		throw new Error("Could not resolve table cell position");
	}
	return $cell.pos;
};
