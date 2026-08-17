import type { Editor } from "@tiptap/core";
import { TableView } from "@tiptap/extension-table";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
	type Command,
	type SelectionBookmark,
	TextSelection,
} from "@tiptap/pm/state";
import {
	addColumnAfter,
	addRowAfter,
	CellSelection,
	cellAround,
	columnResizingPluginKey,
	deleteColumn,
	deleteRow,
	findTable,
	moveTableColumn,
	moveTableRow,
	selectedRect,
	TableMap,
} from "@tiptap/pm/tables";
import { Mapping, type Step } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";

type TableEdge = "column" | "row";
type TableEdgeChange = "add" | "remove";
type TableExtendMutation = {
	change: -1 | 1;
	inverseSteps: Step[];
	mapping: Mapping;
};
type TableExtendDrag = {
	button: HTMLButtonElement;
	changeCount: number;
	changes: TableExtendMutation[];
	edge: TableEdge;
	hasDragged: boolean;
	pointerId: number;
	selectionBookmark: SelectionBookmark;
	selectionMapping: Mapping;
	startX: number;
	startY: number;
	step: number;
};
type TableHtmlAttributes = NonNullable<
	ConstructorParameters<typeof TableView>[3]
>;

export const NOTE_TABLE_RESIZE_HANDLE_WIDTH = 7;
const NOTE_TABLE_CONTROL_GAP = 4;
export const NOTE_TABLE_CONTROL_HIDE_DELAY_MS = 180;
export const NOTE_TABLE_EXTEND_DRAG_START_PX = 4;
const NOTE_TABLE_EXTEND_DRAG_MIN_STEP_PX = 32;
const NOTE_TABLE_EXTEND_DRAG_MAX_STEP_PX = 96;

const TABLE_EDGE_COMMANDS: Record<
	TableEdge,
	Record<TableEdgeChange, Command>
> = {
	column: {
		add: addColumnAfter,
		remove: deleteColumn,
	},
	row: {
		add: addRowAfter,
		remove: deleteRow,
	},
};

const getTableCellColumnIndex = (
	row: HTMLTableRowElement,
	cell: HTMLTableCellElement,
) => {
	let columnIndex = 0;
	for (const candidate of row.cells) {
		if (candidate === cell) {
			return columnIndex;
		}
		columnIndex += candidate.colSpan;
	}
	return -1;
};

const getTableColumnCount = (table: HTMLTableElement) =>
	Array.from(table.rows).reduce(
		(maximum, row) =>
			Math.max(
				maximum,
				Array.from(row.cells).reduce((count, cell) => count + cell.colSpan, 0),
			),
		0,
	);

const getTableContext = (
	view: EditorView,
	contentDOM: HTMLTableSectionElement,
) => {
	const position = view.posAtDOM(contentDOM, 0);
	const $position = view.state.doc.resolve(position);
	let tableDepth = $position.depth;

	while (
		tableDepth > 0 &&
		$position.node(tableDepth).type.spec.tableRole !== "table"
	) {
		tableDepth -= 1;
	}

	const table = $position.node(tableDepth);
	if (table.type.spec.tableRole !== "table") {
		return null;
	}

	return {
		map: TableMap.get(table),
		table,
		tableStart: $position.start(tableDepth),
	};
};

const createEdgeButton = (edge: TableEdge) => {
	const button = document.createElement("button");

	button.type = "button";
	button.contentEditable = "false";
	button.className = `note-table-add note-table-add-${edge}`;
	button.setAttribute(
		"aria-label",
		edge === "column" ? "Add table column" : "Add table row",
	);
	button.setAttribute("data-note-table-edge", edge);
	return button;
};

export class NoteTableView extends TableView {
	readonly #view: EditorView;
	readonly #cellMinWidth: number;
	readonly #addColumnButton: HTMLButtonElement | null;
	readonly #addRowButton: HTMLButtonElement | null;
	readonly #scrollContainer: HTMLDivElement;
	#extendDrag: TableExtendDrag | null = null;
	#hideControlsTimer: ReturnType<typeof setTimeout> | null = null;
	#isDestroyed = false;
	#lockedColumnWidth: number | null = null;

	constructor(
		node: ProseMirrorNode,
		cellMinWidth: number,
		view: EditorView,
		HTMLAttributes: TableHtmlAttributes = {},
	) {
		super(node, cellMinWidth, view, HTMLAttributes);
		this.#view = view;
		this.#cellMinWidth = cellMinWidth;
		this.dom.classList.add("note-table-wrapper");

		const scrollContainer = document.createElement("div");
		scrollContainer.className = "note-table-scroll";
		scrollContainer.appendChild(this.table);
		this.dom.appendChild(scrollContainer);
		this.#scrollContainer = scrollContainer;

		if (!view.editable) {
			this.#addColumnButton = null;
			this.#addRowButton = null;
			return;
		}

		this.#addColumnButton = createEdgeButton("column");
		this.#addRowButton = createEdgeButton("row");
		this.dom.append(this.#addColumnButton, this.#addRowButton);

		this.#addColumnButton.addEventListener(
			"pointerdown",
			this.#handlePointerDown,
		);
		this.#addRowButton.addEventListener("pointerdown", this.#handlePointerDown);
		this.dom.addEventListener("pointerenter", this.#handlePointerEnter);
		this.dom.addEventListener("pointerleave", this.#scheduleControlsHide);
		this.#addColumnButton.addEventListener(
			"pointerenter",
			this.#cancelControlsHide,
		);
		this.#addRowButton.addEventListener(
			"pointerenter",
			this.#cancelControlsHide,
		);
		this.table.addEventListener("mousemove", this.#handleTableMouseMove);
		this.table.addEventListener("mousedown", this.#handleResizeMouseDown);
		queueMicrotask(this.#positionControls);
	}

	update(node: ProseMirrorNode) {
		const didUpdate = super.update(node);
		if (didUpdate) {
			this.#applyLockedColumnWidth(node);
			queueMicrotask(this.#positionControls);
		}
		return didUpdate;
	}

	readonly #applyLockedColumnWidth = (table: ProseMirrorNode) => {
		if (this.#lockedColumnWidth === null) {
			return;
		}
		const width = this.#lockedColumnWidth * TableMap.get(table).width;
		this.table.style.width = `${width}px`;
		this.table.style.minWidth = `${width}px`;
	};

	readonly #lockCurrentColumnWidth = () => {
		const columnCount = TableMap.get(this.node).width;
		const tableWidth = this.table.getBoundingClientRect().width;
		if (columnCount <= 0 || !Number.isFinite(tableWidth) || tableWidth <= 0) {
			return;
		}
		this.#lockedColumnWidth = tableWidth / columnCount;
		this.#applyLockedColumnWidth(this.node);
	};

	readonly #getRenderedColumnWidths = (columnCount: number) => {
		const firstRow = this.table.rows.item(0);
		if (!firstRow || columnCount <= 0) {
			return null;
		}

		const widths: number[] = [];
		for (const cell of firstRow.cells) {
			const cellWidth = cell.getBoundingClientRect().width;
			if (!Number.isFinite(cellWidth) || cellWidth <= 0) {
				return null;
			}
			const columnWidth = Math.max(
				this.#cellMinWidth,
				Math.round(cellWidth / cell.colSpan),
			);
			for (let spanIndex = 0; spanIndex < cell.colSpan; spanIndex += 1) {
				widths.push(columnWidth);
			}
		}

		return widths.length === columnCount ? widths : null;
	};

	readonly #handleResizeMouseDown = (event: MouseEvent) => {
		if (!this.#view.editable || event.button !== 0) {
			return;
		}
		const resizeState = columnResizingPluginKey.getState(this.#view.state);
		if (!resizeState || resizeState.activeHandle < 0 || resizeState.dragging) {
			return;
		}

		const context = getTableContext(this.#view, this.contentDOM);
		if (!context) {
			return;
		}
		const columnWidths = this.#getRenderedColumnWidths(context.map.width);
		if (!columnWidths || columnWidths.length !== context.map.width) {
			return;
		}

		let transaction = this.#view.state.tr;
		const visitedCells = new Set<number>();
		for (const cellOffset of context.map.map) {
			if (visitedCells.has(cellOffset)) {
				continue;
			}
			visitedCells.add(cellOffset);
			const cell = context.table.nodeAt(cellOffset);
			if (!cell) {
				continue;
			}
			const cellRect = context.map.findCell(cellOffset);
			const columnIndex = cellRect.left;
			const colspan = cellRect.right - cellRect.left;
			const colwidth = columnWidths.slice(columnIndex, columnIndex + colspan);
			transaction = transaction.setNodeMarkup(
				context.tableStart + cellOffset,
				null,
				{ ...cell.attrs, colwidth },
			);
		}

		if (this.#view.state.selection instanceof CellSelection) {
			transaction = transaction.setSelection(
				TextSelection.near(
					transaction.doc.resolve(resizeState.activeHandle + 1),
				),
			);
		}
		this.#lockedColumnWidth = null;
		this.#view.dispatch(transaction);
	};

	readonly #cancelControlsHide = () => {
		if (this.#hideControlsTimer !== null) {
			clearTimeout(this.#hideControlsTimer);
			this.#hideControlsTimer = null;
		}
	};

	readonly #hideControls = () => {
		this.#hideControlsTimer = null;
		if (this.#extendDrag) {
			return;
		}
		this.#addColumnButton?.removeAttribute("data-note-table-visible");
		this.#addRowButton?.removeAttribute("data-note-table-visible");
	};

	readonly #scheduleControlsHide = () => {
		this.#cancelControlsHide();
		if (this.#extendDrag) {
			return;
		}
		this.#hideControlsTimer = setTimeout(
			this.#hideControls,
			NOTE_TABLE_CONTROL_HIDE_DELAY_MS,
		);
	};

	readonly #handlePointerEnter = () => {
		this.#cancelControlsHide();
		this.#positionControls();
	};

	readonly #positionControls = () => {
		if (this.#isDestroyed || !this.#addColumnButton || !this.#addRowButton) {
			return;
		}

		const wrapperRect = this.dom.getBoundingClientRect();
		const tableRect = this.table.getBoundingClientRect();
		this.#addColumnButton.style.left = `${
			tableRect.right - wrapperRect.left + NOTE_TABLE_CONTROL_GAP
		}px`;
		this.#addColumnButton.style.top = `${tableRect.top - wrapperRect.top}px`;
		this.#addColumnButton.style.height = `${tableRect.height}px`;
		this.#addRowButton.style.left = `${tableRect.left - wrapperRect.left}px`;
		this.#addRowButton.style.top = `${
			tableRect.bottom - wrapperRect.top + NOTE_TABLE_CONTROL_GAP
		}px`;
		this.#addRowButton.style.width = `${tableRect.width}px`;
	};

	readonly #handleTableMouseMove = (event: MouseEvent) => {
		this.#cancelControlsHide();
		this.#positionControls();
		if (!this.#view.editable) {
			return;
		}

		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}

		const cell = target.closest("td, th");
		if (!(cell instanceof HTMLTableCellElement)) {
			return;
		}

		const row = cell.closest("tr");
		if (!(row instanceof HTMLTableRowElement)) {
			return;
		}

		const rowIndex = Array.from(this.table.rows).indexOf(row);
		const columnIndex = getTableCellColumnIndex(row, cell);
		this.#addRowButton?.toggleAttribute(
			"data-note-table-visible",
			rowIndex + cell.rowSpan === this.table.rows.length,
		);
		this.#addColumnButton?.toggleAttribute(
			"data-note-table-visible",
			columnIndex + cell.colSpan === getTableColumnCount(this.table),
		);
	};

	readonly #handlePointerDown = (event: PointerEvent) => {
		event.preventDefault();
		event.stopPropagation();

		if (!this.#view.editable || event.button !== 0 || this.#extendDrag) {
			return;
		}

		const target = event.currentTarget;
		if (!(target instanceof HTMLButtonElement)) {
			return;
		}

		const edge = target.dataset.noteTableEdge;
		if (edge !== "column" && edge !== "row") {
			return;
		}
		const step = this.#getExtendDragStep(edge);
		if (step === null) {
			return;
		}
		if (edge === "column") {
			this.#lockCurrentColumnWidth();
			this.#scrollContainer.setAttribute("data-note-table-column-dragging", "");
		}

		this.#cancelControlsHide();
		target.setAttribute("data-note-table-dragging", "");
		if (typeof target.setPointerCapture === "function") {
			target.setPointerCapture(event.pointerId);
		}
		this.#extendDrag = {
			button: target,
			changeCount: 0,
			changes: [],
			edge,
			hasDragged: false,
			pointerId: event.pointerId,
			selectionBookmark: this.#view.state.selection.getBookmark(),
			selectionMapping: new Mapping(),
			startX: event.clientX,
			startY: event.clientY,
			step,
		};
		window.addEventListener("pointermove", this.#handleExtendPointerMove);
		window.addEventListener("pointerup", this.#handleExtendPointerUp);
		window.addEventListener("pointercancel", this.#handleExtendPointerCancel);
	};

	readonly #getExtendDragStep = (edge: TableEdge) => {
		const columnCount = getTableColumnCount(this.table);
		const lastRow = this.table.rows.item(this.table.rows.length - 1);
		const rawStep =
			edge === "row"
				? lastRow?.getBoundingClientRect().height
				: this.table.getBoundingClientRect().width / columnCount;
		if (
			typeof rawStep !== "number" ||
			!Number.isFinite(rawStep) ||
			rawStep <= 0
		) {
			return null;
		}
		return Math.min(
			NOTE_TABLE_EXTEND_DRAG_MAX_STEP_PX,
			Math.max(NOTE_TABLE_EXTEND_DRAG_MIN_STEP_PX, rawStep),
		);
	};

	readonly #changeAtEdge = (
		edge: TableEdge,
		change: -1 | 1,
	): TableExtendMutation | null => {
		const context = getTableContext(this.#view, this.contentDOM);
		if (!context) {
			return null;
		}
		if (
			change === -1 &&
			(edge === "row" ? context.table.childCount <= 1 : context.map.width <= 1)
		) {
			return null;
		}

		const lastCellPosition = context.map.map.at(-1);
		if (lastCellPosition === undefined) {
			return null;
		}
		const selection = CellSelection.create(
			this.#view.state.doc,
			context.tableStart + lastCellPosition,
		);

		this.#view.dispatch(this.#view.state.tr.setSelection(selection));
		let inverseSteps: Step[] | null = null;
		let mapping: Mapping | null = null;
		const dispatch = (transaction: Parameters<EditorView["dispatch"]>[0]) => {
			inverseSteps = transaction.steps
				.map((step, index) => step.invert(transaction.docs[index]))
				.reverse();
			mapping = transaction.mapping;
			this.#view.dispatch(transaction);
		};
		const command = TABLE_EDGE_COMMANDS[edge][change === 1 ? "add" : "remove"];
		const didChange = command(this.#view.state, dispatch);
		if (!didChange || !inverseSteps || !mapping) {
			return null;
		}

		queueMicrotask(this.#positionControls);
		return { change, inverseSteps, mapping };
	};

	readonly #restoreExtendSelection = (drag: TableExtendDrag) => {
		const selection = drag.selectionBookmark
			.map(drag.selectionMapping)
			.resolve(this.#view.state.doc);
		this.#view.dispatch(this.#view.state.tr.setSelection(selection));
	};

	readonly #revertLastExtendChange = (drag: TableExtendDrag) => {
		const mutation = drag.changes.pop();
		if (!mutation) {
			return false;
		}

		let transaction = this.#view.state.tr;
		for (const step of mutation.inverseSteps) {
			transaction = transaction.step(step);
		}
		this.#view.dispatch(transaction);
		drag.selectionMapping.appendMapping(transaction.mapping);
		drag.changeCount -= mutation.change;
		queueMicrotask(this.#positionControls);
		return true;
	};

	readonly #handleExtendPointerMove = (event: PointerEvent) => {
		const drag = this.#extendDrag;
		if (!drag || event.pointerId !== drag.pointerId) {
			return;
		}

		event.preventDefault();
		const deltaX = event.clientX - drag.startX;
		const deltaY = event.clientY - drag.startY;
		if (Math.hypot(deltaX, deltaY) >= NOTE_TABLE_EXTEND_DRAG_START_PX) {
			drag.hasDragged = true;
		}

		const edgeDistance = drag.edge === "row" ? deltaY : deltaX;
		const absoluteDistance = Math.abs(edgeDistance);
		const desiredCount =
			absoluteDistance <= NOTE_TABLE_EXTEND_DRAG_START_PX
				? 0
				: Math.sign(edgeDistance) *
					Math.ceil(
						(absoluteDistance - NOTE_TABLE_EXTEND_DRAG_START_PX) / drag.step,
					);

		while (drag.changeCount < desiredCount) {
			if (drag.changeCount < 0) {
				if (!this.#revertLastExtendChange(drag)) {
					break;
				}
				continue;
			}
			const mutation = this.#changeAtEdge(drag.edge, 1);
			if (!mutation) {
				break;
			}
			drag.changes.push(mutation);
			drag.selectionMapping.appendMapping(mutation.mapping);
			drag.changeCount += 1;
		}
		while (drag.changeCount > desiredCount) {
			if (drag.changeCount > 0) {
				if (!this.#revertLastExtendChange(drag)) {
					break;
				}
				continue;
			}
			const mutation = this.#changeAtEdge(drag.edge, -1);
			if (!mutation) {
				break;
			}
			drag.changes.push(mutation);
			drag.selectionMapping.appendMapping(mutation.mapping);
			drag.changeCount -= 1;
		}
		this.#restoreExtendSelection(drag);
	};

	readonly #stopExtendDrag = () => {
		const drag = this.#extendDrag;
		if (!drag) {
			return null;
		}

		window.removeEventListener("pointermove", this.#handleExtendPointerMove);
		window.removeEventListener("pointerup", this.#handleExtendPointerUp);
		window.removeEventListener(
			"pointercancel",
			this.#handleExtendPointerCancel,
		);
		drag.button.removeAttribute("data-note-table-dragging");
		if (drag.edge === "column") {
			this.#scrollContainer.removeAttribute("data-note-table-column-dragging");
		}
		if (
			typeof drag.button.releasePointerCapture === "function" &&
			drag.button.hasPointerCapture?.(drag.pointerId)
		) {
			drag.button.releasePointerCapture(drag.pointerId);
		}
		this.#extendDrag = null;
		return drag;
	};

	readonly #handleExtendPointerUp = (event: PointerEvent) => {
		const drag = this.#extendDrag;
		if (!drag || event.pointerId !== drag.pointerId) {
			return;
		}
		event.preventDefault();

		const completedDrag = this.#stopExtendDrag();
		if (
			completedDrag &&
			!completedDrag.hasDragged &&
			completedDrag.changeCount === 0
		) {
			const mutation = this.#changeAtEdge(completedDrag.edge, 1);
			if (mutation) {
				completedDrag.changes.push(mutation);
				completedDrag.selectionMapping.appendMapping(mutation.mapping);
				completedDrag.changeCount += 1;
			}
		}
		if (completedDrag) {
			this.#restoreExtendSelection(completedDrag);
		}
		this.#view.focus();
	};

	readonly #handleExtendPointerCancel = (event: PointerEvent) => {
		if (event.pointerId !== this.#extendDrag?.pointerId) {
			return;
		}
		const canceledDrag = this.#stopExtendDrag();
		if (canceledDrag) {
			this.#restoreExtendSelection(canceledDrag);
		}
	};

	destroy() {
		this.#isDestroyed = true;
		this.#stopExtendDrag();
		this.#cancelControlsHide();
		this.dom.removeEventListener("pointerenter", this.#handlePointerEnter);
		this.dom.removeEventListener("pointerleave", this.#scheduleControlsHide);
		this.table.removeEventListener("mousemove", this.#handleTableMouseMove);
		this.table.removeEventListener("mousedown", this.#handleResizeMouseDown);
		this.#addColumnButton?.removeEventListener(
			"pointerenter",
			this.#cancelControlsHide,
		);
		this.#addRowButton?.removeEventListener(
			"pointerenter",
			this.#cancelControlsHide,
		);
		this.#addColumnButton?.removeEventListener(
			"pointerdown",
			this.#handlePointerDown,
		);
		this.#addRowButton?.removeEventListener(
			"pointerdown",
			this.#handlePointerDown,
		);
	}
}

export type TableHandleOrientation = "column" | "row";
export type TableStructureDeleteKind = "columns" | "rows" | "table";
type TableMenuKind = TableHandleOrientation | "cells";

type TableControlStyle = {
	height?: number;
	left: number;
	top: number;
	width?: number;
};

export type TableHandleTarget = {
	cellPosition: number;
	columnIndex: number;
	columnStyle: TableControlStyle;
	columnCount: number;
	isHeaderRow: boolean;
	rowIndex: number;
	rowStyle: TableControlStyle;
	rowCount: number;
	simpleGrid: boolean;
	wrapper: HTMLElement;
};

export type TableCellSelectionTarget = {
	canMerge: boolean;
	canSplit: boolean;
	deleteKinds: TableStructureDeleteKind[];
	style: TableControlStyle;
	wrapper: HTMLElement;
};

type NoteTableInteractionSnapshot = {
	cellSelectionTarget: TableCellSelectionTarget | null;
	handleTarget: TableHandleTarget | null;
	openMenu: TableMenuKind | null;
};

const TABLE_HANDLE_SIZE = 12;
const TABLE_CELL_SELECTION_HANDLE_SIZE = 16;

const haveEqualStyles = (first: TableControlStyle, second: TableControlStyle) =>
	first.height === second.height &&
	first.left === second.left &&
	first.top === second.top &&
	first.width === second.width;

const areEqualTableCellSelectionTargets = (
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

const areEqualTableHandleTargets = (
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

const createTableCellSelectionTarget = (
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

const createTableHandleTarget = (
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

const selectTableHandle = (
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

const duplicateRow = (editor: Editor, target: TableHandleTarget) => {
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

const duplicateColumn = (editor: Editor, target: TableHandleTarget) => {
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

export class NoteTableInteractionSession {
	readonly editor: Editor;
	readonly #listeners = new Set<() => void>();
	#hideTargetTimer: ReturnType<typeof setTimeout> | null = null;
	#isListening = false;
	#snapshot: NoteTableInteractionSnapshot = {
		cellSelectionTarget: null,
		handleTarget: null,
		openMenu: null,
	};

	constructor(editor: Editor) {
		this.editor = editor;
	}

	readonly getSnapshot = () => this.#snapshot;

	readonly subscribe = (listener: () => void) => {
		this.#listeners.add(listener);
		if (this.#listeners.size === 1) {
			this.#startListening();
		}
		return () => {
			this.#listeners.delete(listener);
			if (this.#listeners.size === 0) {
				this.#stopListening();
			}
		};
	};

	readonly setOpenMenu = (openMenu: TableMenuKind | null) => {
		if (
			(openMenu === "row" || openMenu === "column") &&
			this.#snapshot.handleTarget
		) {
			selectTableHandle(this.editor, this.#snapshot.handleTarget, openMenu);
		}
		this.#setSnapshot({ ...this.#snapshot, openMenu });
	};

	readonly runHandleCommand = (
		target: TableHandleTarget,
		orientation: TableHandleOrientation,
		command: () => boolean,
	) => {
		if (!selectTableHandle(this.editor, target, orientation)) {
			return false;
		}
		return command();
	};

	readonly moveHandle = (
		target: TableHandleTarget,
		orientation: TableHandleOrientation,
		offset: -1 | 1,
	) => {
		const isRow = orientation === "row";
		const index = isRow ? target.rowIndex : target.columnIndex;
		return this.runHandleCommand(target, orientation, () => {
			const command = isRow
				? moveTableRow({
						from: index,
						to: index + offset,
						pos: target.cellPosition,
					})
				: moveTableColumn({
						from: index,
						to: index + offset,
						pos: target.cellPosition,
					});
			return command(this.editor.state, (transaction) =>
				this.editor.view.dispatch(transaction),
			);
		});
	};

	readonly duplicateHandle = (
		target: TableHandleTarget,
		orientation: TableHandleOrientation,
	) =>
		this.runHandleCommand(target, orientation, () =>
			orientation === "row"
				? duplicateRow(this.editor, target)
				: duplicateColumn(this.editor, target),
		);

	readonly #setSnapshot = (snapshot: NoteTableInteractionSnapshot) => {
		if (
			this.#snapshot.openMenu === snapshot.openMenu &&
			areEqualTableHandleTargets(
				this.#snapshot.handleTarget,
				snapshot.handleTarget,
			) &&
			areEqualTableCellSelectionTargets(
				this.#snapshot.cellSelectionTarget,
				snapshot.cellSelectionTarget,
			)
		) {
			return;
		}
		this.#snapshot = snapshot;
		for (const listener of this.#listeners) {
			listener();
		}
	};

	readonly #updateCellSelectionTarget = () => {
		this.#setSnapshot({
			...this.#snapshot,
			cellSelectionTarget: createTableCellSelectionTarget(this.editor),
		});
	};

	readonly #handleSelectionUpdate = () => {
		this.#setSnapshot({
			...this.#snapshot,
			cellSelectionTarget: createTableCellSelectionTarget(this.editor),
			openMenu:
				this.#snapshot.openMenu === "cells" ? null : this.#snapshot.openMenu,
		});
	};

	readonly #cancelTargetHide = () => {
		if (this.#hideTargetTimer !== null) {
			clearTimeout(this.#hideTargetTimer);
			this.#hideTargetTimer = null;
		}
	};

	readonly #scheduleTargetHide = () => {
		if (this.#hideTargetTimer !== null) {
			return;
		}
		this.#hideTargetTimer = setTimeout(() => {
			this.#hideTargetTimer = null;
			this.#setSnapshot({ ...this.#snapshot, handleTarget: null });
		}, NOTE_TABLE_CONTROL_HIDE_DELAY_MS);
	};

	readonly #handlePointerMove = (event: PointerEvent) => {
		const eventTarget = event.target;
		if (!(eventTarget instanceof Element)) {
			return;
		}
		if (eventTarget.closest("[data-note-table-handle]")) {
			this.#cancelTargetHide();
			return;
		}

		const cell = eventTarget.closest("td, th");
		if (
			cell instanceof HTMLTableCellElement &&
			this.editor.view.dom.contains(cell)
		) {
			const handleTarget = createTableHandleTarget(this.editor, cell);
			if (handleTarget) {
				this.#cancelTargetHide();
				this.#setSnapshot({ ...this.#snapshot, handleTarget });
				return;
			}
		}

		if (this.#snapshot.openMenu) {
			this.#cancelTargetHide();
		} else {
			this.#scheduleTargetHide();
		}
	};

	readonly #handleScroll = () => {
		this.#cancelTargetHide();
		this.#setSnapshot({
			...this.#snapshot,
			cellSelectionTarget: createTableCellSelectionTarget(this.editor),
			handleTarget: null,
		});
	};

	readonly #handleResize = () => {
		this.#setSnapshot({
			...this.#snapshot,
			cellSelectionTarget: createTableCellSelectionTarget(this.editor),
			handleTarget: null,
		});
	};

	readonly #startListening = () => {
		if (this.#isListening || !this.editor.isEditable) {
			return;
		}
		this.#isListening = true;
		this.#updateCellSelectionTarget();
		this.editor.on("selectionUpdate", this.#handleSelectionUpdate);
		this.editor.on("transaction", this.#updateCellSelectionTarget);
		window.addEventListener("resize", this.#handleResize);
		document.addEventListener("pointermove", this.#handlePointerMove);
		document.addEventListener("scroll", this.#handleScroll, true);
	};

	readonly #stopListening = () => {
		if (!this.#isListening) {
			return;
		}
		this.#isListening = false;
		this.#cancelTargetHide();
		this.editor.off("selectionUpdate", this.#handleSelectionUpdate);
		this.editor.off("transaction", this.#updateCellSelectionTarget);
		window.removeEventListener("resize", this.#handleResize);
		document.removeEventListener("pointermove", this.#handlePointerMove);
		document.removeEventListener("scroll", this.#handleScroll, true);
	};
}
