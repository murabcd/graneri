import { TableCell, TableHeader } from "@tiptap/extension-table";

export const NOTE_TABLE_CELL_BACKGROUNDS = [
	"gray",
	"brown",
	"orange",
	"yellow",
	"green",
	"blue",
	"purple",
	"pink",
	"red",
] as const;

export type NoteTableCellBackground =
	(typeof NOTE_TABLE_CELL_BACKGROUNDS)[number];

const NOTE_TABLE_CELL_ALIGNMENTS = ["left", "center", "right"] as const;

export type NoteTableCellAlignment =
	(typeof NOTE_TABLE_CELL_ALIGNMENTS)[number];

const isNoteTableCellBackground = (
	value: string | null,
): value is NoteTableCellBackground =>
	NOTE_TABLE_CELL_BACKGROUNDS.some((background) => background === value);

const cellBackgroundAttribute = {
	default: null,
	parseHTML: (element: HTMLElement) => {
		const background = element.getAttribute("data-cell-background");
		return isNoteTableCellBackground(background) ? background : null;
	},
	renderHTML: (attributes: { cellBackground?: unknown }) =>
		typeof attributes.cellBackground === "string" &&
		isNoteTableCellBackground(attributes.cellBackground)
			? { "data-cell-background": attributes.cellBackground }
			: {},
};

const isNoteTableCellAlignment = (
	value: string | null,
): value is NoteTableCellAlignment =>
	NOTE_TABLE_CELL_ALIGNMENTS.some((alignment) => alignment === value);

const cellAlignmentAttribute = {
	default: null,
	parseHTML: (element: HTMLElement) => {
		const alignment = element.getAttribute("data-cell-align");
		return isNoteTableCellAlignment(alignment) ? alignment : null;
	},
	renderHTML: (attributes: { align?: unknown }) =>
		typeof attributes.align === "string" &&
		isNoteTableCellAlignment(attributes.align)
			? { "data-cell-align": attributes.align }
			: {},
};

const tableCellAttributes = () => ({
	align: cellAlignmentAttribute,
	cellBackground: cellBackgroundAttribute,
});

export const NoteTableCell = TableCell.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			...tableCellAttributes(),
		};
	},
});

export const NoteTableHeader = TableHeader.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			...tableCellAttributes(),
		};
	},
});
