import { z } from "zod";

export const ARTIFACT_AUTHORING_TOOL_NAMES = Object.freeze({
	document: "author_document",
	pdf: "author_pdf",
	presentation: "author_presentation",
	spreadsheet: "author_spreadsheet",
});

export const ARTIFACT_TOOL_NAMESPACE = Object.freeze({
	name: "artifact_creation",
	description:
		"Create visual charts, generated images, and downloadable Office or PDF files when the user explicitly requests those outputs.",
});

export const ARTIFACT_MEDIA_TYPES = Object.freeze({
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	pdf: "application/pdf",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

const boundedText = (maximum = 50_000) => z.string().min(1).max(maximum);
const optionalText = (maximum = 10_000) => z.string().max(maximum).optional();
const MAX_SPREADSHEET_CELLS_PER_REQUEST = 250_000;
const filenameSchema = boundedText(240).refine(
	(value) => value !== "." && value !== ".." && !/[\\/\0]/u.test(value),
	"Artifact filenames must not contain a path.",
);

export const artifactSourceSchema = z.object({
	filename: filenameSchema,
	mediaType: boundedText(200),
	storageId: boundedText(200),
});

const documentTextBlockSchema = z
	.discriminatedUnion("type", [
		z.object({
			level: z.number().int().min(1).max(3),
			text: boundedText(),
			type: z.literal("heading"),
		}),
		z.object({
			text: boundedText(),
			type: z.literal("paragraph"),
		}),
		z.object({
			items: z.array(boundedText(5_000)).min(1).max(100),
			type: z.enum(["bullet_list", "numbered_list"]),
		}),
		z.object({
			headers: z.array(boundedText(2_000)).min(1).max(30),
			rows: z.array(z.array(z.string().max(5_000)).min(1).max(30)).max(500),
			type: z.literal("table"),
		}),
		z.object({ type: z.literal("page_break") }),
	])
	.superRefine((block, context) => {
		if (block.type !== "table") {
			return;
		}
		for (const [rowIndex, row] of block.rows.entries()) {
			if (row.length !== block.headers.length) {
				context.addIssue({
					code: "custom",
					message: "Document table rows must match the header width.",
					path: ["rows", rowIndex],
				});
			}
		}
	});

export const documentSpecSchema = z.object({
	author: optionalText(240),
	blocks: z.array(documentTextBlockSchema).min(1).max(1_000),
	orientation: z.enum(["portrait", "landscape"]).default("portrait"),
	pageSize: z.enum(["a4", "letter"]).default("a4"),
	subtitle: optionalText(2_000),
	title: boundedText(2_000),
});

const documentEditSchema = z.discriminatedUnion("type", [
	z.object({
		blocks: z.array(documentTextBlockSchema).min(1).max(1_000),
		type: z.literal("append_blocks"),
	}),
	z.object({
		find: boundedText(10_000),
		replace: z.string().max(50_000),
		replaceAll: z.boolean().default(false),
		type: z.literal("replace_text"),
	}),
	z.object({
		title: boundedText(2_000),
		type: z.literal("set_title"),
	}),
]);

const docxOutputSchema = z.object({
	filename: filenameSchema,
	format: z.literal("docx"),
});
const pdfOutputSchema = z.object({
	filename: filenameSchema,
	format: z.literal("pdf"),
});
const documentOutputSchema = z.discriminatedUnion("format", [
	docxOutputSchema,
	pdfOutputSchema,
]);

const cellValueSchema = z.union([
	z.string().max(20_000),
	z.number(),
	z.boolean(),
	z.null(),
]);

const spreadsheetChartSchema = z.object({
	categoryColumn: boundedText(120),
	dataColumns: z.array(boundedText(120)).min(1).max(12),
	position: boundedText(30).default("H2"),
	title: boundedText(240),
	type: z.enum(["bar", "line", "pie"]),
});

export const spreadsheetSheetSchema = z.object({
	charts: z.array(spreadsheetChartSchema).max(12).default([]),
	frozenRows: z.number().int().min(0).max(100).default(1),
	name: boundedText(31),
	rows: z.array(z.array(cellValueSchema).max(100)).min(1).max(5_000),
});

const spreadsheetEditSchema = z.discriminatedUnion("type", [
	z.object({
		rows: z.array(z.array(cellValueSchema).max(100)).min(1).max(5_000),
		sheet: boundedText(31),
		type: z.literal("append_rows"),
	}),
	z.object({
		cell: z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/u),
		sheet: boundedText(31),
		type: z.literal("set_cell"),
		value: cellValueSchema,
	}),
	z.object({
		sheet: spreadsheetSheetSchema,
		type: z.literal("add_sheet"),
	}),
]);

const presentationSlideSchema = z.object({
	bullets: z.array(boundedText(160)).max(6).default([]),
	footer: optionalText(120),
	layout: z.enum(["title", "section", "content", "two_column"]),
	leftBullets: z.array(boundedText(120)).max(5).default([]),
	rightBullets: z.array(boundedText(120)).max(5).default([]),
	speakerNotes: optionalText(20_000),
	subtitle: optionalText(240),
	title: boundedText(120),
});

export const presentationSpecSchema = z.object({
	author: optionalText(240),
	slides: z.array(presentationSlideSchema).min(1).max(100),
	title: boundedText(120),
});

const presentationEditSchema = z.discriminatedUnion("type", [
	z.object({
		afterSlide: z.number().int().min(0).max(10_000),
		slides: z.array(presentationSlideSchema).min(1).max(100),
		type: z.literal("insert_slides"),
	}),
	z.object({
		find: boundedText(10_000),
		replace: z.string().max(120),
		replaceAll: z.boolean().default(false),
		type: z.literal("replace_text"),
	}),
	z.object({
		slideNumbers: z.array(z.number().int().min(1)).min(1).max(100),
		type: z.literal("delete_slides"),
	}),
]);

const pdfEditSchema = z.discriminatedUnion("type", [
	z.object({
		blocks: z.array(documentTextBlockSchema).min(1).max(1_000),
		title: boundedText(2_000),
		type: z.literal("append_pages"),
	}),
	z.object({
		pageNumbers: z.array(z.number().int().min(1)).min(1).max(200),
		type: z.literal("delete_pages"),
	}),
	z.object({
		pageNumbers: z.array(z.number().int().min(1)).min(1).max(200),
		type: z.literal("reorder_pages"),
	}),
]);

const documentCreateOperationSchema = z.object({
	document: documentSpecSchema,
	kind: z.literal("document_create"),
	outputs: z.array(documentOutputSchema).min(1).max(2),
});
const documentToolCreateOperationSchema = z.object({
	document: documentSpecSchema,
	kind: z.literal("document_create"),
	outputs: z.union([
		z.tuple([docxOutputSchema]),
		z.tuple([docxOutputSchema, pdfOutputSchema]),
	]),
});
const pdfToolCreateOperationSchema = z.object({
	document: documentSpecSchema,
	kind: z.literal("document_create"),
	outputs: z.tuple([pdfOutputSchema]),
});
const documentEditOperationSchema = z.object({
	edits: z.array(documentEditSchema).min(1).max(100),
	kind: z.literal("document_edit"),
	outputs: z.array(documentOutputSchema).min(1).max(2),
	source: artifactSourceSchema,
});
const documentExportOperationSchema = z.object({
	kind: z.literal("document_export"),
	outputs: z
		.array(documentOutputSchema)
		.length(1)
		.refine(
			([output]) => output.format === "pdf",
			"Document export must produce one PDF output.",
		),
	source: artifactSourceSchema,
});
const spreadsheetCreateOperationSchema = z.object({
	filename: filenameSchema,
	kind: z.literal("spreadsheet_create"),
	sheets: z.array(spreadsheetSheetSchema).min(1).max(20),
});
const spreadsheetEditOperationSchema = z.object({
	edits: z.array(spreadsheetEditSchema).min(1).max(1_000),
	filename: filenameSchema,
	kind: z.literal("spreadsheet_edit"),
	source: artifactSourceSchema,
});
const presentationCreateOperationSchema = z.object({
	filename: filenameSchema,
	kind: z.literal("presentation_create"),
	presentation: presentationSpecSchema,
});
const presentationEditOperationSchema = z.object({
	edits: z.array(presentationEditSchema).min(1).max(100),
	filename: filenameSchema,
	kind: z.literal("presentation_edit"),
	source: artifactSourceSchema,
});
const pdfEditOperationSchema = z.object({
	edits: z.array(pdfEditSchema).min(1).max(100),
	filename: filenameSchema,
	kind: z.literal("pdf_edit"),
	source: artifactSourceSchema,
});

const artifactAuthoringOperationSchema = z.discriminatedUnion("kind", [
	documentCreateOperationSchema,
	documentEditOperationSchema,
	documentExportOperationSchema,
	spreadsheetCreateOperationSchema,
	spreadsheetEditOperationSchema,
	presentationCreateOperationSchema,
	presentationEditOperationSchema,
	pdfEditOperationSchema,
]);

const expectedExtension = (format) => `.${format}`;

const hasExpectedFormat = (filename, format, mediaType) =>
	filename.toLowerCase().endsWith(expectedExtension(format)) &&
	mediaType === ARTIFACT_MEDIA_TYPES[format];

const validateArtifactAuthoringInput = (input, context) => {
	const addIssue = (message) => context.addIssue({ code: "custom", message });
	const spreadsheetCellCount = (rows) =>
		rows.reduce((total, row) => total + row.length, 0);
	if ("outputs" in input) {
		const filenames = input.outputs.map((output) => output.filename);
		if (new Set(filenames).size !== filenames.length) {
			addIssue("Document output filenames must be unique.");
		}
		for (const output of input.outputs) {
			if (
				!output.filename
					.toLowerCase()
					.endsWith(expectedExtension(output.format))
			) {
				addIssue(`Document output filename must end with .${output.format}.`);
			}
		}
	}
	if (
		(input.kind === "spreadsheet_create" ||
			input.kind === "spreadsheet_edit") &&
		!input.filename.toLowerCase().endsWith(".xlsx")
	) {
		addIssue("Spreadsheet output filename must end with .xlsx.");
	}
	if (input.kind === "spreadsheet_create") {
		const cellCount = input.sheets.reduce(
			(total, sheet) => total + spreadsheetCellCount(sheet.rows),
			0,
		);
		if (cellCount > MAX_SPREADSHEET_CELLS_PER_REQUEST) {
			addIssue("Spreadsheet creation exceeds the 250,000-cell limit.");
		}
	}
	if (input.kind === "spreadsheet_edit") {
		const cellCount = input.edits.reduce((total, edit) => {
			if (edit.type === "append_rows") {
				return total + spreadsheetCellCount(edit.rows);
			}
			if (edit.type === "add_sheet") {
				return total + spreadsheetCellCount(edit.sheet.rows);
			}
			return total + 1;
		}, 0);
		if (cellCount > MAX_SPREADSHEET_CELLS_PER_REQUEST) {
			addIssue("Spreadsheet edits exceed the 250,000-cell limit.");
		}
	}
	if (input.kind === "document_edit") {
		const appendedBlockCount = input.edits.reduce(
			(total, edit) =>
				edit.type === "append_blocks" ? total + edit.blocks.length : total,
			0,
		);
		if (appendedBlockCount > 1_000) {
			addIssue("Document edits exceed the 1,000-block append limit.");
		}
	}
	if (input.kind === "presentation_edit") {
		const insertedSlideCount = input.edits.reduce(
			(total, edit) =>
				edit.type === "insert_slides" ? total + edit.slides.length : total,
			0,
		);
		if (insertedSlideCount > 100) {
			addIssue("Presentation edits exceed the 100-slide insertion limit.");
		}
	}
	if (input.kind === "pdf_edit") {
		const appendedBlockCount = input.edits.reduce(
			(total, edit) =>
				edit.type === "append_pages" ? total + edit.blocks.length : total,
			0,
		);
		if (appendedBlockCount > 1_000) {
			addIssue("PDF edits exceed the 1,000-block append limit.");
		}
	}
	if (
		(input.kind === "presentation_create" ||
			input.kind === "presentation_edit") &&
		!input.filename.toLowerCase().endsWith(".pptx")
	) {
		addIssue("Presentation output filename must end with .pptx.");
	}
	if (
		input.kind === "pdf_edit" &&
		!input.filename.toLowerCase().endsWith(".pdf")
	) {
		addIssue("PDF output filename must end with .pdf.");
	}
	if (
		(input.kind === "document_edit" || input.kind === "document_export") &&
		!hasExpectedFormat(input.source.filename, "docx", input.source.mediaType)
	) {
		addIssue("Document editing and export require a DOCX source.");
	}
	if (
		input.kind === "spreadsheet_edit" &&
		!hasExpectedFormat(input.source.filename, "xlsx", input.source.mediaType)
	) {
		addIssue("Spreadsheet edits require an XLSX source.");
	}
	if (
		input.kind === "presentation_edit" &&
		!hasExpectedFormat(input.source.filename, "pptx", input.source.mediaType)
	) {
		addIssue("Presentation edits require a PPTX source.");
	}
	if (
		input.kind === "pdf_edit" &&
		!hasExpectedFormat(input.source.filename, "pdf", input.source.mediaType)
	) {
		addIssue("PDF edits require a PDF source.");
	}
};

const withArtifactAuthoringValidation = (schema) =>
	schema.superRefine(validateArtifactAuthoringInput);

export const documentAuthoringInputSchema = withArtifactAuthoringValidation(
	z.discriminatedUnion("kind", [
		documentToolCreateOperationSchema,
		documentEditOperationSchema,
	]),
);
export const pdfAuthoringInputSchema = withArtifactAuthoringValidation(
	z.discriminatedUnion("kind", [
		pdfToolCreateOperationSchema,
		documentExportOperationSchema,
		pdfEditOperationSchema,
	]),
);
export const spreadsheetAuthoringInputSchema = withArtifactAuthoringValidation(
	z.discriminatedUnion("kind", [
		spreadsheetCreateOperationSchema,
		spreadsheetEditOperationSchema,
	]),
);
export const presentationAuthoringInputSchema = withArtifactAuthoringValidation(
	z.discriminatedUnion("kind", [
		presentationCreateOperationSchema,
		presentationEditOperationSchema,
	]),
);
export const artifactAuthoringInputSchema = withArtifactAuthoringValidation(
	artifactAuthoringOperationSchema,
);

export const generatedArtifactSchema = z.object({
	filename: filenameSchema,
	mediaType: boundedText(200),
	providerMetadata: z.object({
		graneri: z.object({
			generatedBy: z.literal("ai"),
			storageId: boundedText(200),
		}),
	}),
	sizeBytes: z.number().int().nonnegative(),
	url: z.url(),
});

export const artifactToolOutputSchema = z.object({
	artifacts: z.array(generatedArtifactSchema).min(1).max(4),
});

export const getArtifactFormatMediaType = (format) => {
	const mediaType = ARTIFACT_MEDIA_TYPES[format];
	if (!mediaType) {
		throw new Error(`Unsupported artifact format: ${format}`);
	}
	return mediaType;
};

export const parseArtifactToolOutput = (value) => {
	const result = artifactToolOutputSchema.safeParse(value);
	return result.success ? result.data : null;
};
