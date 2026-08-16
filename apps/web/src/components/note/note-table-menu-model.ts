import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
	CellSelection,
	cellAround,
	findTable,
	selectedRect,
} from "@tiptap/pm/tables";
import type { CSSProperties } from "react";
import {
	getTableCellColumnIndex,
	getTableColumnCount,
	NOTE_TABLE_CONTROL_GAP,
} from "@/lib/note-table";

export type TableHandleOrientation = "column" | "row";

export type TableHandleTarget = {
	cellPosition: number;
	columnIndex: number;
	columnStyle: CSSProperties;
	columnCount: number;
	isHeaderRow: boolean;
	rowIndex: number;
	rowStyle: CSSProperties;
	rowCount: number;
	simpleGrid: boolean;
	wrapper: HTMLElement;
};

export type TableStructureDeleteKind = "columns" | "rows" | "table";

export type TableCellSelectionTarget = {
	canMerge: boolean;
	canSplit: boolean;
	deleteKinds: TableStructureDeleteKind[];
	style: CSSProperties;
	wrapper: HTMLElement;
};

const TABLE_HANDLE_SIZE = 12;
const TABLE_CELL_SELECTION_HANDLE_SIZE = 16;

const haveEqualStyles = (first: CSSProperties, second: CSSProperties) =>
	first.height === second.height &&
	first.left === second.left &&
	first.top === second.top &&
	first.width === second.width;

export const areEqualTableCellSelectionTargets = (
	first: TableCellSelectionTarget | null,
	second: TableCellSelectionTarget | null,
) =>
	first === second ||
	(first !== null &&
		second !== null &&
		first.wrapper === second.wrapper &&
		first.canMerge === second.canMerge &&
		first.canSplit === second.canSplit &&
		first.deleteKinds.length === second.deleteKinds.length &&
		first.deleteKinds.every(
			(kind, index) => kind === second.deleteKinds[index],
		) &&
		haveEqualStyles(first.style, second.style));

export const areEqualTableHandleTargets = (
	first: TableHandleTarget | null,
	second: TableHandleTarget | null,
) =>
	first === second ||
	(first !== null &&
		second !== null &&
		first.wrapper === second.wrapper &&
		first.cellPosition === second.cellPosition &&
		first.columnIndex === second.columnIndex &&
		first.columnCount === second.columnCount &&
		first.isHeaderRow === second.isHeaderRow &&
		first.rowIndex === second.rowIndex &&
		first.rowCount === second.rowCount &&
		first.simpleGrid === second.simpleGrid &&
		haveEqualStyles(first.columnStyle, second.columnStyle) &&
		haveEqualStyles(first.rowStyle, second.rowStyle));

export const createTableCellSelectionTarget = (
	editor: Editor,
): TableCellSelectionTarget | null => {
	const { selection } = editor.state;
	if (!(selection instanceof CellSelection)) {
		return null;
	}

	let right = Number.NEGATIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	let wrapper: HTMLElement | null = null;
	let selectedCellCount = 0;

	selection.forEachCell((_cell, position) => {
		const nodeDom = editor.view.nodeDOM(position);
		const cell =
			nodeDom instanceof HTMLTableCellElement
				? nodeDom
				: nodeDom instanceof HTMLElement
					? nodeDom.closest("td, th")
					: null;
		if (!(cell instanceof HTMLTableCellElement)) {
			return;
		}

		const cellWrapper = cell.closest(".note-table-wrapper");
		if (!(cellWrapper instanceof HTMLElement)) {
			return;
		}

		const rect = cell.getBoundingClientRect();
		right = Math.max(right, rect.right);
		top = Math.min(top, rect.top);
		bottom = Math.max(bottom, rect.bottom);
		wrapper = cellWrapper;
		selectedCellCount += 1;
	});

	if (selectedCellCount === 0 || wrapper === null) {
		return null;
	}
	const rectangle = selectedRect(editor.state);
	const spansAllColumns =
		rectangle.left === 0 && rectangle.right === rectangle.map.width;
	const spansAllRows =
		rectangle.top === 0 && rectangle.bottom === rectangle.map.height;
	const selectedRowCount = rectangle.bottom - rectangle.top;
	const selectedColumnCount = rectangle.right - rectangle.left;
	const deleteKinds: TableStructureDeleteKind[] = [];
	if (spansAllColumns && spansAllRows) {
		deleteKinds.push("table");
	} else if (spansAllColumns) {
		deleteKinds.push("rows");
	} else if (spansAllRows) {
		deleteKinds.push("columns");
	} else {
		if (selectedRowCount >= 2) {
			deleteKinds.push("rows");
		}
		if (selectedColumnCount >= 2) {
			deleteKinds.push("columns");
		}
	}

	return {
		canMerge: editor.can().mergeCells(),
		canSplit: editor.can().splitCell(),
		deleteKinds,
		style: {
			left: right - TABLE_CELL_SELECTION_HANDLE_SIZE / 2,
			top: (top + bottom - TABLE_CELL_SELECTION_HANDLE_SIZE) / 2,
		},
		wrapper,
	};
};

export const createTableHandleTarget = (
	editor: Editor,
	cell: HTMLTableCellElement,
): TableHandleTarget | null => {
	const row = cell.closest("tr");
	const table = cell.closest("table");
	const wrapper = table?.closest(".note-table-wrapper");
	if (
		!(row instanceof HTMLTableRowElement) ||
		!(table instanceof HTMLTableElement) ||
		!(wrapper instanceof HTMLElement)
	) {
		return null;
	}

	const rowIndex = Array.from(table.rows).indexOf(row);
	const columnIndex = getTableCellColumnIndex(row, cell);
	if (rowIndex < 0 || columnIndex < 0) {
		return null;
	}

	const $cell = cellAround(
		editor.state.doc.resolve(editor.view.posAtDOM(cell, 0)),
	);
	if (!$cell) {
		return null;
	}

	const tableRect = table.getBoundingClientRect();
	const rowRect = row.getBoundingClientRect();
	const cellRect = cell.getBoundingClientRect();

	return {
		cellPosition: $cell.pos,
		columnIndex,
		columnCount: getTableColumnCount(table),
		columnStyle: {
			height: TABLE_HANDLE_SIZE,
			left: cellRect.left,
			top: tableRect.top - TABLE_HANDLE_SIZE - NOTE_TABLE_CONTROL_GAP,
			width: cellRect.width,
		},
		isHeaderRow: Array.from(row.cells).every(
			(tableCell) => tableCell.tagName === "TH",
		),
		rowIndex,
		rowCount: table.rows.length,
		rowStyle: {
			height: rowRect.height,
			left: tableRect.left - TABLE_HANDLE_SIZE - NOTE_TABLE_CONTROL_GAP,
			top: rowRect.top,
			width: TABLE_HANDLE_SIZE,
		},
		simpleGrid: Array.from(table.rows).every((tableRow) =>
			Array.from(tableRow.cells).every(
				(tableCell) => tableCell.colSpan === 1 && tableCell.rowSpan === 1,
			),
		),
		wrapper,
	};
};

const resolveTableCell = (editor: Editor, cellPosition: number) => {
	const $position = editor.state.doc.resolve(cellPosition);
	const role = $position.nodeAfter?.type.spec.tableRole;
	return role === "cell" || role === "header_cell"
		? $position
		: cellAround($position);
};

export const selectTableHandle = (
	editor: Editor,
	target: TableHandleTarget,
	orientation: TableHandleOrientation,
) => {
	const $cell = resolveTableCell(editor, target.cellPosition);
	if (!$cell) {
		return false;
	}

	const selection =
		orientation === "row"
			? CellSelection.rowSelection($cell)
			: CellSelection.colSelection($cell);
	editor.view.dispatch(editor.state.tr.setSelection(selection));
	return true;
};

export const duplicateRow = (editor: Editor, target: TableHandleTarget) => {
	if (!target.simpleGrid) {
		return false;
	}

	const $cell = resolveTableCell(editor, target.cellPosition);
	const table = $cell ? findTable($cell) : null;
	const row = table?.node.child(target.rowIndex);
	if (!table || !row) {
		return false;
	}

	let insertOffset = 0;
	for (let rowIndex = 0; rowIndex <= target.rowIndex; rowIndex += 1) {
		insertOffset += table.node.child(rowIndex).nodeSize;
	}

	editor.view.dispatch(
		editor.state.tr.insert(table.start + insertOffset, row.copy(row.content)),
	);
	return true;
};

export const duplicateColumn = (editor: Editor, target: TableHandleTarget) => {
	if (!target.simpleGrid) {
		return false;
	}

	const $cell = resolveTableCell(editor, target.cellPosition);
	const table = $cell ? findTable($cell) : null;
	if (!table) {
		return false;
	}

	const rows: ProseMirrorNode[] = [];
	for (let rowIndex = 0; rowIndex < table.node.childCount; rowIndex += 1) {
		const row = table.node.child(rowIndex);
		const cells = Array.from({ length: row.childCount }, (_, cellIndex) =>
			row.child(cellIndex),
		);
		const cell = cells[target.columnIndex];
		if (!cell) {
			return false;
		}
		cells.splice(target.columnIndex + 1, 0, cell.copy(cell.content));
		rows.push(row.type.create(row.attrs, cells, row.marks));
	}

	const nextTable = table.node.type.create(
		table.node.attrs,
		rows,
		table.node.marks,
	);
	editor.view.dispatch(
		editor.state.tr.replaceWith(
			table.pos,
			table.pos + table.node.nodeSize,
			nextTable,
		),
	);
	return true;
};

export const runTableCommand = (
	editor: Editor,
	target: TableHandleTarget,
	orientation: TableHandleOrientation,
	command: () => boolean,
) => {
	if (!selectTableHandle(editor, target, orientation)) {
		return false;
	}
	return command();
};
