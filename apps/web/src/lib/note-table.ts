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
	columnResizingPluginKey,
	deleteColumn,
	deleteRow,
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
export const NOTE_TABLE_CONTROL_GAP = 4;
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

export const getTableCellColumnIndex = (
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

export const getTableColumnCount = (table: HTMLTableElement) =>
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
