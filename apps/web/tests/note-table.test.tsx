import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CellSelection, columnResizingPluginKey } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";
import {
	NOTE_TABLE_CONTROL_HIDE_DELAY_MS,
	NOTE_TABLE_EXTEND_DRAG_START_PX,
} from "../src/lib/note-table";
import {
	getCellPosition,
	getTableDimensions,
	mockElementFromPoint,
	renderTable,
	restoreElementFromPoint,
	setEdgeDragGeometry,
	setRenderedColumnWidths,
	TABLE_DRAG_STEP_PX,
} from "./note-table-test-utils";

afterEach(() => {
	cleanup();
	restoreElementFromPoint();
});

describe("note tables", () => {
	it("adds a row or column from the quiet table-edge controls", async () => {
		const editor = await renderTable();
		const table = setEdgeDragGeometry(editor);
		const tableRect = table.getBoundingClientRect();
		const wrapper = editor.view.dom.querySelector(".note-table-wrapper");
		expect(wrapper).not.toBeNull();
		if (!wrapper) {
			throw new Error("Table wrapper did not render");
		}
		fireEvent.pointerEnter(wrapper);
		expect(
			screen.getByRole("button", {
				name: "Add table column",
			}).style.left,
		).toBe(`${tableRect.width + 4}px`);
		expect(
			screen.getByRole("button", {
				name: "Add table row",
			}).style.top,
		).toBe(`${tableRect.height + 4}px`);

		const addRow = screen.getByRole("button", { name: "Add table row" });
		fireEvent.pointerDown(addRow, { button: 0, pointerId: 1 });
		fireEvent.pointerUp(window, { pointerId: 1 });
		expect(getTableDimensions(editor)).toEqual({ columns: 3, rows: 4 });

		const addColumn = screen.getByRole("button", {
			name: "Add table column",
		});
		fireEvent.pointerDown(addColumn, { button: 0, pointerId: 2 });
		fireEvent.pointerUp(window, { pointerId: 2 });
		expect(getTableDimensions(editor)).toEqual({ columns: 4, rows: 4 });
	});

	it("extends a table by multiple rows or columns while dragging an edge control", async () => {
		const editor = await renderTable();
		setEdgeDragGeometry(editor);
		const addRow = screen.getByRole("button", { name: "Add table row" });
		const addColumn = screen.getByRole("button", {
			name: "Add table column",
		});
		const start = 100;

		fireEvent.pointerDown(addRow, {
			button: 0,
			clientX: start,
			clientY: start,
			pointerId: 3,
		});
		fireEvent.pointerMove(window, {
			clientX: start,
			clientY: start + NOTE_TABLE_EXTEND_DRAG_START_PX + TABLE_DRAG_STEP_PX * 3,
			pointerId: 3,
		});
		expect(getTableDimensions(editor)).toEqual({ columns: 3, rows: 6 });
		expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
		expect(editor.view.dom.querySelector(".selectedCell")).toBeNull();
		fireEvent.pointerUp(window, { pointerId: 3 });

		fireEvent.pointerDown(addColumn, {
			button: 0,
			clientX: start,
			clientY: start,
			pointerId: 4,
		});
		fireEvent.pointerMove(window, {
			clientX: start + NOTE_TABLE_EXTEND_DRAG_START_PX + TABLE_DRAG_STEP_PX * 2,
			clientY: start,
			pointerId: 4,
		});
		expect(getTableDimensions(editor)).toEqual({ columns: 5, rows: 6 });
		fireEvent.pointerUp(window, { pointerId: 4 });
	});

	it("keeps the starting column width visible while extending the table", async () => {
		const editor = await renderTable();
		const table = setEdgeDragGeometry(editor, { tableWidth: 300 });
		const addColumn = screen.getByRole("button", {
			name: "Add table column",
		});
		const start = 100;

		fireEvent.pointerDown(addColumn, {
			button: 0,
			clientX: start,
			clientY: start,
			pointerId: 41,
		});
		expect(
			table
				.closest(".note-table-scroll")
				?.hasAttribute("data-note-table-column-dragging"),
		).toBe(true);
		fireEvent.pointerMove(window, {
			clientX: start + NOTE_TABLE_EXTEND_DRAG_START_PX + 200,
			clientY: start,
			pointerId: 41,
		});

		const extendedColumnCount = getTableDimensions(editor).columns;
		expect(extendedColumnCount).toBeGreaterThan(3);
		expect(table.style.width).toBe(`${extendedColumnCount * 100}px`);
		fireEvent.pointerUp(window, { pointerId: 41 });
		expect(
			table
				.closest(".note-table-scroll")
				?.hasAttribute("data-note-table-column-dragging"),
		).toBe(false);

		expect(editor.commands.undo()).toBe(true);
		const undoneColumnCount = getTableDimensions(editor).columns;
		expect(undoneColumnCount).toBeLessThan(extendedColumnCount);
		expect(table.style.width).toBe(`${undoneColumnCount * 100}px`);
	});

	it("removes rows or columns by dragging inward and restores content when reversing", async () => {
		const editor = await renderTable();
		setEdgeDragGeometry(editor);
		const addRow = screen.getByRole("button", { name: "Add table row" });
		const addColumn = screen.getByRole("button", {
			name: "Add table column",
		});
		const start = 300;

		fireEvent.pointerDown(addRow, {
			button: 0,
			clientX: start,
			clientY: start,
			pointerId: 5,
		});
		fireEvent.pointerMove(window, {
			clientX: start,
			clientY: start - NOTE_TABLE_EXTEND_DRAG_START_PX - TABLE_DRAG_STEP_PX * 2,
			pointerId: 5,
		});
		expect(getTableDimensions(editor)).toEqual({ columns: 3, rows: 1 });
		expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
		expect(editor.view.dom.querySelector(".selectedCell")).toBeNull();

		fireEvent.pointerMove(window, {
			clientX: start,
			clientY: start,
			pointerId: 5,
		});
		expect(getTableDimensions(editor)).toEqual({ columns: 3, rows: 3 });
		expect(
			editor.getJSON().content?.[0]?.content?.[2]?.content?.[0],
		).toMatchObject({
			content: [
				{
					content: [{ text: "third-1", type: "text" }],
					type: "paragraph",
				},
			],
			type: "tableCell",
		});
		fireEvent.pointerMove(window, {
			clientX: start,
			clientY: start - NOTE_TABLE_EXTEND_DRAG_START_PX - TABLE_DRAG_STEP_PX,
			pointerId: 5,
		});
		expect(getTableDimensions(editor)).toEqual({ columns: 3, rows: 2 });
		fireEvent.pointerUp(window, { pointerId: 5 });
		expect(editor.commands.undo()).toBe(true);
		expect(getTableDimensions(editor)).toEqual({ columns: 3, rows: 3 });

		fireEvent.pointerDown(addColumn, {
			button: 0,
			clientX: start,
			clientY: start,
			pointerId: 6,
		});
		fireEvent.pointerMove(window, {
			clientX:
				start - NOTE_TABLE_EXTEND_DRAG_START_PX - TABLE_DRAG_STEP_PX * 10,
			clientY: start,
			pointerId: 6,
		});
		expect(getTableDimensions(editor)).toEqual({ columns: 1, rows: 3 });
		fireEvent.pointerUp(window, { pointerId: 6 });
	});

	it("reveals only the add controls for the hovered table edges", async () => {
		const editor = await renderTable();
		const cells = screen.getAllByRole("cell");
		const addRow = screen.getByRole("button", { name: "Add table row" });
		const addColumn = screen.getByRole("button", {
			name: "Add table column",
		});
		const firstCell = cells[0];
		if (!firstCell) {
			throw new Error("Table cell did not render");
		}
		mockElementFromPoint(firstCell);

		fireEvent.mouseMove(cells[0]);
		expect(addRow.hasAttribute("data-note-table-visible")).toBe(false);
		expect(addColumn.hasAttribute("data-note-table-visible")).toBe(false);

		fireEvent.mouseMove(cells[6]);
		expect(addRow.hasAttribute("data-note-table-visible")).toBe(true);
		expect(addColumn.hasAttribute("data-note-table-visible")).toBe(false);
		const wrapper = editor.view.dom.querySelector(".note-table-wrapper");
		expect(wrapper).not.toBeNull();
		if (!wrapper) {
			throw new Error("Table wrapper did not render");
		}
		fireEvent.pointerLeave(wrapper);
		fireEvent.pointerEnter(addRow);
		await new Promise((resolve) =>
			setTimeout(resolve, NOTE_TABLE_CONTROL_HIDE_DELAY_MS + 20),
		);
		expect(addRow.hasAttribute("data-note-table-visible")).toBe(true);

		fireEvent.mouseMove(cells[2]);
		expect(addRow.hasAttribute("data-note-table-visible")).toBe(false);
		expect(addColumn.hasAttribute("data-note-table-visible")).toBe(true);

		fireEvent.mouseMove(cells[8]);
		expect(addRow.hasAttribute("data-note-table-visible")).toBe(true);
		expect(addColumn.hasAttribute("data-note-table-visible")).toBe(true);
	});

	it("does not freeze column widths when revealing the resize handle", async () => {
		const editor = await renderTable();
		const firstCell = editor.view.dom.querySelector("td");
		expect(firstCell).not.toBeNull();
		if (!firstCell) {
			throw new Error("Table cell did not render");
		}
		mockElementFromPoint(firstCell);

		fireEvent.mouseMove(firstCell, { clientX: 118 });

		const table = editor.getJSON().content?.[0];
		for (const row of table?.content ?? []) {
			for (const cell of row.content ?? []) {
				expect(cell.attrs?.colwidth).toBeNull();
			}
		}
		expect(editor.view.dom.querySelector("table")?.style.width).toBe("");
	});

	it("keeps every column stable and clears a column selection when resizing", async () => {
		const editor = await renderTable();
		const cells = Array.from(
			editor.view.dom.querySelectorAll<HTMLTableCellElement>("td"),
		);
		const firstCell = cells[0];
		const thirdCell = cells[2];
		const table = editor.view.dom.querySelector("table");
		expect(firstCell).toBeTruthy();
		expect(thirdCell).toBeTruthy();
		expect(table).toBeInstanceOf(HTMLTableElement);
		if (!firstCell || !thirdCell || !(table instanceof HTMLTableElement)) {
			throw new Error("Table did not render");
		}

		let transaction = editor.state.tr;
		for (const cell of cells) {
			if (cell.cellIndex > 1) {
				continue;
			}
			const position = getCellPosition(editor, cell);
			const node = editor.state.doc.nodeAt(position);
			if (!node) {
				throw new Error("Table cell did not resolve");
			}
			transaction = transaction.setNodeMarkup(position, null, {
				...node.attrs,
				colwidth: [cell.cellIndex === 0 ? 100 : 95],
			});
		}
		editor.view.dispatch(transaction);

		const updatedCells = Array.from(
			editor.view.dom.querySelectorAll<HTMLTableCellElement>("td"),
		);
		const updatedFirstCell = updatedCells[0];
		const updatedThirdCell = updatedCells[2];
		if (!updatedFirstCell || !updatedThirdCell) {
			throw new Error("Updated table did not render");
		}
		const firstPosition = getCellPosition(editor, updatedFirstCell);
		const thirdPosition = getCellPosition(editor, updatedThirdCell);
		editor.view.dispatch(
			editor.state.tr.setSelection(
				CellSelection.colSelection(editor.state.doc.resolve(thirdPosition)),
			),
		);
		expect(editor.view.dom.querySelectorAll(".selectedCell")).toHaveLength(3);

		setEdgeDragGeometry(editor, { tableWidth: 900 });
		setRenderedColumnWidths(editor, [300, 300, 300]);
		editor.view.dispatch(
			editor.state.tr.setMeta(columnResizingPluginKey, {
				setHandle: firstPosition,
			}),
		);
		fireEvent.mouseDown(updatedFirstCell, { button: 0, clientX: 100 });

		expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
		expect(editor.view.dom.querySelector(".selectedCell")).toBeNull();
		const documentTable = editor.getJSON().content?.[0];
		for (const row of documentTable?.content ?? []) {
			for (const cell of row.content ?? []) {
				expect(cell.attrs?.colwidth).toEqual([300]);
			}
		}
		expect(table.style.width).toBe("900px");

		fireEvent.mouseUp(window, { clientX: 100 });
	});

	it("shows row and column actions only while hovering a table cell", async () => {
		const user = userEvent.setup();
		await renderTable();
		const firstCell = screen.getAllByRole("cell")[0];
		expect(firstCell).toBeTruthy();
		if (!firstCell) {
			throw new Error("Table cell did not render");
		}

		expect(screen.queryByRole("button", { name: "Row actions" })).toBeNull();
		fireEvent.pointerMove(firstCell);

		const rowActions = await screen.findByRole("button", {
			name: "Row actions",
		});
		expect(screen.getByRole("button", { name: "Column actions" })).toBeTruthy();
		fireEvent.pointerMove(document.body);
		fireEvent.pointerMove(rowActions);
		await new Promise((resolve) =>
			setTimeout(resolve, NOTE_TABLE_CONTROL_HIDE_DELAY_MS + 20),
		);
		expect(screen.getByRole("button", { name: "Row actions" })).toBeTruthy();

		await user.click(rowActions);
		expect(
			await screen.findByRole("menuitemcheckbox", { name: "Header row" }),
		).toBeTruthy();
		for (const option of [
			"Move row down",
			"Insert row above",
			"Insert row below",
			"Color",
			"Alignment",
			"Duplicate row",
			"Delete row",
		]) {
			expect(
				await screen.findByRole("menuitem", { name: option }),
			).toBeTruthy();
		}
		expect(screen.queryByRole("menuitem", { name: "Move row up" })).toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Delete rows" })).toBeNull();
		expect(
			screen.queryByRole("menuitem", { name: "Delete columns" }),
		).toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Delete table" })).toBeNull();
		expect(document.body.style.pointerEvents).toBe("none");

		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(document.body.style.pointerEvents).toBe(""));
	});

	it("hides row and column move actions at table boundaries", async () => {
		const user = userEvent.setup();
		await renderTable();
		const cells = screen.getAllByRole("cell");
		const cases = [
			{
				cell: cells[0],
				handle: "Row actions",
				hidden: "Move row up",
				visible: "Move row down",
			},
			{
				cell: cells[6],
				handle: "Row actions",
				hidden: "Move row down",
				visible: "Move row up",
			},
			{
				cell: cells[0],
				handle: "Column actions",
				hidden: "Move column left",
				visible: "Move column right",
			},
			{
				cell: cells[2],
				handle: "Column actions",
				hidden: "Move column right",
				visible: "Move column left",
			},
		];

		for (const item of cases) {
			if (!item.cell) {
				throw new Error("Table boundary cell did not render");
			}
			fireEvent.pointerMove(item.cell);
			await user.click(
				await screen.findByRole("button", { name: item.handle }),
			);
			expect(screen.queryByRole("menuitem", { name: item.hidden })).toBeNull();
			expect(
				await screen.findByRole("menuitem", { name: item.visible }),
			).toBeTruthy();
			fireEvent.keyDown(document, { key: "Escape" });
			await waitFor(() => expect(document.body.style.pointerEvents).toBe(""));
		}
	});

	it("toggles the first row between body and header cells", async () => {
		const user = userEvent.setup();
		const editor = await renderTable();
		const firstCell = screen.getAllByRole("cell")[0];
		expect(firstCell).toBeTruthy();
		if (!firstCell) {
			throw new Error("Table cell did not render");
		}

		fireEvent.pointerMove(firstCell);
		await user.click(
			await screen.findByRole("button", { name: "Row actions" }),
		);
		await user.click(
			await screen.findByRole("menuitemcheckbox", { name: "Header row" }),
		);

		await waitFor(() => {
			const firstRow = editor.getJSON().content?.[0]?.content?.[0];
			expect(
				firstRow?.content?.every((cell) => cell.type === "tableHeader"),
			).toBe(true);
		});

		const firstHeader = screen.getAllByRole("columnheader")[0];
		expect(firstHeader).toBeTruthy();
		if (!firstHeader) {
			throw new Error("Table header did not render");
		}
		fireEvent.pointerMove(firstHeader);
		await user.click(
			await screen.findByRole("button", { name: "Row actions" }),
		);
		const activeHeaderRow = await screen.findByRole("menuitemcheckbox", {
			name: "Header row",
		});
		expect(activeHeaderRow.getAttribute("aria-checked")).toBe("true");
		await user.click(activeHeaderRow);

		await waitFor(() => {
			const restoredFirstRow = editor.getJSON().content?.[0]?.content?.[0];
			expect(
				restoredFirstRow?.content?.every((cell) => cell.type === "tableCell"),
			).toBe(true);
		});
	});

	it("undoes the header-row toggle through editor history", async () => {
		const user = userEvent.setup();
		const editor = await renderTable();
		const firstCell = screen.getAllByRole("cell")[0];
		if (!firstCell) {
			throw new Error("Table cell did not render");
		}

		fireEvent.pointerMove(firstCell);
		await user.click(
			await screen.findByRole("button", { name: "Row actions" }),
		);
		await user.click(
			await screen.findByRole("menuitemcheckbox", { name: "Header row" }),
		);

		await waitFor(() => {
			const firstRow = editor.getJSON().content?.[0]?.content?.[0];
			expect(
				firstRow?.content?.every((cell) => cell.type === "tableHeader"),
			).toBe(true);
		});

		expect(editor.commands.undo()).toBe(true);
		await waitFor(() => {
			const firstRow = editor.getJSON().content?.[0]?.content?.[0];
			expect(
				firstRow?.content?.every((cell) => cell.type === "tableCell"),
			).toBe(true);
		});
	});

	it("marks the applied row color as selected", async () => {
		const user = userEvent.setup();
		const editor = await renderTable();
		const openRowColorMenu = async () => {
			const firstCell = screen.getAllByRole("cell")[0];
			if (!firstCell) {
				throw new Error("Table cell did not render");
			}
			fireEvent.pointerMove(firstCell);
			await user.click(
				await screen.findByRole("button", { name: "Row actions" }),
			);
			const colorMenu = await screen.findByRole("menuitem", { name: "Color" });
			colorMenu.focus();
			fireEvent.keyDown(colorMenu, { key: "ArrowRight" });
			await waitFor(() =>
				expect(colorMenu.getAttribute("data-state")).toBe("open"),
			);
		};

		await openRowColorMenu();
		expect(
			(
				await screen.findByRole("menuitemcheckbox", { name: "Default" })
			).getAttribute("aria-checked"),
		).toBe("true");
		await user.click(
			await screen.findByRole("menuitemcheckbox", { name: "Orange" }),
		);

		await waitFor(() => {
			const firstRow = editor.getJSON().content?.[0]?.content?.[0];
			expect(
				firstRow?.content?.every(
					(cell) => cell.attrs?.cellBackground === "orange",
				),
			).toBe(true);
		});

		await openRowColorMenu();
		expect(
			(
				await screen.findByRole("menuitemcheckbox", { name: "Orange" })
			).getAttribute("aria-checked"),
		).toBe("true");
	});

	it("shows selected-cell actions and merges or splits the selected cells", async () => {
		const user = userEvent.setup();
		const editor = await renderTable();
		const cells = Array.from(editor.view.dom.querySelectorAll("td"));
		const firstCell = cells[0];
		const secondCell = cells[1];
		if (!firstCell || !secondCell) {
			throw new Error("Table cells did not render");
		}

		expect(
			editor.commands.setCellSelection({
				anchorCell: getCellPosition(editor, firstCell),
				headCell: getCellPosition(editor, secondCell),
			}),
		).toBe(true);

		await user.click(
			await screen.findByRole("button", { name: "Selected cell actions" }),
		);
		for (const option of [
			"Merge cells",
			"Color",
			"Alignment",
			"Clear cell contents",
			"Delete columns",
		]) {
			expect(
				await screen.findByRole("menuitem", { name: option }),
			).toBeTruthy();
		}
		expect(screen.queryByRole("menuitem", { name: "Delete rows" })).toBeNull();
		expect(document.body.style.pointerEvents).toBe("none");

		await user.click(screen.getByRole("menuitem", { name: "Merge cells" }));
		await waitFor(() => {
			expect(document.body.style.pointerEvents).toBe("");
			const firstRow = editor.getJSON().content?.[0]?.content?.[0];
			expect(firstRow?.content).toHaveLength(2);
			expect(firstRow?.content?.[0]?.attrs?.colspan).toBe(2);
		});

		const mergedCell = editor.view.dom.querySelector("td");
		if (!mergedCell) {
			throw new Error("Merged cell did not render");
		}
		const mergedCellPosition = getCellPosition(editor, mergedCell);
		editor.commands.setCellSelection({
			anchorCell: mergedCellPosition,
			headCell: mergedCellPosition,
		});
		await user.click(
			await screen.findByRole("button", { name: "Selected cell actions" }),
		);
		await user.click(
			await screen.findByRole("menuitem", { name: "Split cell" }),
		);

		await waitFor(() => {
			const restoredFirstRow = editor.getJSON().content?.[0]?.content?.[0];
			expect(restoredFirstRow?.content).toHaveLength(3);
			expect(restoredFirstRow?.content?.[0]?.attrs?.colspan).toBe(1);
		});
	});

	it("hides merge and split actions when a single cell cannot use them", async () => {
		const user = userEvent.setup();
		const editor = await renderTable();
		const firstCell = editor.view.dom.querySelector("td");
		if (!firstCell) {
			throw new Error("Table cell did not render");
		}

		const position = getCellPosition(editor, firstCell);
		editor.commands.setCellSelection({
			anchorCell: position,
			headCell: position,
		});
		await user.click(
			await screen.findByRole("button", { name: "Selected cell actions" }),
		);

		expect(screen.queryByRole("menuitem", { name: "Merge cells" })).toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Split cell" })).toBeNull();
		expect(
			await screen.findByRole("menuitem", { name: "Clear cell contents" }),
		).toBeTruthy();
	});

	it("offers both structural delete actions for a selection spanning two rows and columns", async () => {
		const user = userEvent.setup();
		const editor = await renderTable();
		const cells = Array.from(editor.view.dom.querySelectorAll("td"));
		const firstCell = cells[0];
		const lastCell = cells[4];
		if (!firstCell || !lastCell) {
			throw new Error("Table cells did not render");
		}

		editor.commands.setCellSelection({
			anchorCell: getCellPosition(editor, firstCell),
			headCell: getCellPosition(editor, lastCell),
		});
		await user.click(
			await screen.findByRole("button", { name: "Selected cell actions" }),
		);

		expect(
			await screen.findByRole("menuitem", { name: "Delete rows" }),
		).toBeTruthy();
		expect(
			await screen.findByRole("menuitem", { name: "Delete columns" }),
		).toBeTruthy();
		expect(screen.queryByRole("menuitem", { name: "Delete table" })).toBeNull();
	});

	it("offers row deletion for two vertically selected cells", async () => {
		const user = userEvent.setup();
		const editor = await renderTable();
		const cells = Array.from(editor.view.dom.querySelectorAll("td"));
		const firstCell = cells[0];
		const secondRowCell = cells[3];
		if (!firstCell || !secondRowCell) {
			throw new Error("Table cells did not render");
		}

		editor.commands.setCellSelection({
			anchorCell: getCellPosition(editor, firstCell),
			headCell: getCellPosition(editor, secondRowCell),
		});
		await user.click(
			await screen.findByRole("button", { name: "Selected cell actions" }),
		);

		expect(
			await screen.findByRole("menuitem", { name: "Delete rows" }),
		).toBeTruthy();
		expect(
			screen.queryByRole("menuitem", { name: "Delete columns" }),
		).toBeNull();
	});

	it("deletes all rows covered by a full-width cell selection", async () => {
		const user = userEvent.setup();
		const editor = await renderTable();
		const cells = Array.from(editor.view.dom.querySelectorAll("td"));
		const firstSelectedCell = cells[3];
		const lastSelectedCell = cells[8];
		if (!firstSelectedCell || !lastSelectedCell) {
			throw new Error("Table cells did not render");
		}

		editor.commands.setCellSelection({
			anchorCell: getCellPosition(editor, firstSelectedCell),
			headCell: getCellPosition(editor, lastSelectedCell),
		});
		await user.click(
			await screen.findByRole("button", { name: "Selected cell actions" }),
		);
		expect(
			screen.queryByRole("menuitem", { name: "Delete columns" }),
		).toBeNull();
		await user.click(
			await screen.findByRole("menuitem", { name: "Delete rows" }),
		);

		await waitFor(() =>
			expect(getTableDimensions(editor)).toEqual({ columns: 3, rows: 1 }),
		);
	});

	it("deletes all columns covered by a full-height cell selection", async () => {
		const user = userEvent.setup();
		const editor = await renderTable();
		const cells = Array.from(editor.view.dom.querySelectorAll("td"));
		const firstSelectedCell = cells[1];
		const lastSelectedCell = cells[7];
		if (!firstSelectedCell || !lastSelectedCell) {
			throw new Error("Table cells did not render");
		}

		editor.commands.setCellSelection({
			anchorCell: getCellPosition(editor, firstSelectedCell),
			headCell: getCellPosition(editor, lastSelectedCell),
		});
		await user.click(
			await screen.findByRole("button", { name: "Selected cell actions" }),
		);
		expect(screen.queryByRole("menuitem", { name: "Delete rows" })).toBeNull();
		await user.click(
			await screen.findByRole("menuitem", { name: "Delete columns" }),
		);

		await waitFor(() =>
			expect(getTableDimensions(editor)).toEqual({ columns: 2, rows: 3 }),
		);
	});

	it("deletes the table when every cell is selected", async () => {
		const user = userEvent.setup();
		const editor = await renderTable();
		const cells = Array.from(editor.view.dom.querySelectorAll("td"));
		const firstCell = cells[0];
		const lastCell = cells[8];
		if (!firstCell || !lastCell) {
			throw new Error("Table cells did not render");
		}

		editor.commands.setCellSelection({
			anchorCell: getCellPosition(editor, firstCell),
			headCell: getCellPosition(editor, lastCell),
		});
		await user.click(
			await screen.findByRole("button", { name: "Selected cell actions" }),
		);
		await user.click(
			await screen.findByRole("menuitem", { name: "Delete table" }),
		);

		await waitFor(() => {
			expect(
				editor.getJSON().content?.some((node) => node.type === "table"),
			).toBe(false);
		});
	});

	it("applies alignment and clears content across a cell selection", async () => {
		const user = userEvent.setup();
		const editor = await renderTable();
		const cells = Array.from(editor.view.dom.querySelectorAll("td"));
		const firstCell = cells[0];
		const secondCell = cells[1];
		if (!firstCell || !secondCell) {
			throw new Error("Table cells did not render");
		}
		const selection = {
			anchorCell: getCellPosition(editor, firstCell),
			headCell: getCellPosition(editor, secondCell),
		};

		editor.commands.setCellSelection(selection);
		await user.click(
			await screen.findByRole("button", { name: "Selected cell actions" }),
		);
		const alignmentMenu = await screen.findByRole("menuitem", {
			name: "Alignment",
		});
		alignmentMenu.focus();
		fireEvent.keyDown(alignmentMenu, { key: "ArrowRight" });
		await waitFor(() =>
			expect(alignmentMenu.getAttribute("data-state")).toBe("open"),
		);
		fireEvent.click(await screen.findByRole("menuitem", { name: "Right" }));

		await waitFor(() => {
			const firstRow = editor.getJSON().content?.[0]?.content?.[0];
			expect(firstRow?.content?.[0]?.attrs?.align).toBe("right");
			expect(firstRow?.content?.[1]?.attrs?.align).toBe("right");
		});

		editor.commands.setCellSelection(selection);
		await user.click(
			await screen.findByRole("button", { name: "Selected cell actions" }),
		);
		await user.click(
			await screen.findByRole("menuitem", { name: "Clear cell contents" }),
		);

		await waitFor(() => {
			const firstRow = editor.getJSON().content?.[0]?.content?.[0];
			expect(firstRow?.content?.[0]?.content?.[0]?.content).toBeUndefined();
			expect(firstRow?.content?.[1]?.content?.[0]?.content).toBeUndefined();
		});
	});

	it("does not render editing controls in read-only notes", async () => {
		await renderTable(false);

		expect(screen.queryByRole("button", { name: "Add table row" })).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Add table column" }),
		).toBeNull();
	});
});
