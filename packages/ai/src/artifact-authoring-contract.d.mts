import type { z } from "zod";

export declare const ARTIFACT_AUTHORING_TOOL_NAME = "author_artifact";
export declare const ARTIFACT_TOOL_NAMESPACE: Readonly<{
	name: "artifact_creation";
	description: string;
}>;

export declare const ARTIFACT_MEDIA_TYPES: Readonly<{
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
	pdf: "application/pdf";
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation";
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}>;

export declare const artifactSourceSchema: z.ZodType<{
	filename: string;
	mediaType: string;
	storageId: string;
}>;
export type ArtifactSource = z.infer<typeof artifactSourceSchema>;
export type DocumentBlock =
	| { level: number; text: string; type: "heading" }
	| { text: string; type: "paragraph" }
	| { items: string[]; type: "bullet_list" | "numbered_list" }
	| { headers: string[]; rows: string[][]; type: "table" }
	| { type: "page_break" };
export type DocumentSpec = {
	author?: string;
	blocks: DocumentBlock[];
	orientation: "portrait" | "landscape";
	pageSize: "a4" | "letter";
	subtitle?: string;
	title: string;
};
export type SpreadsheetCellValue = string | number | boolean | null;
export type SpreadsheetSheet = {
	charts: Array<{
		categoryColumn: string;
		dataColumns: string[];
		position: string;
		title: string;
		type: "bar" | "line" | "pie";
	}>;
	frozenRows: number;
	name: string;
	rows: SpreadsheetCellValue[][];
};
export type PresentationSlide = {
	bullets: string[];
	footer?: string;
	layout: "title" | "section" | "content" | "two_column";
	leftBullets: string[];
	rightBullets: string[];
	speakerNotes?: string;
	subtitle?: string;
	title: string;
};
export type PresentationSpec = {
	author?: string;
	slides: PresentationSlide[];
	title: string;
};
export type ArtifactAuthoringInput =
	| {
			document: DocumentSpec;
			kind: "document_create";
			outputs: Array<{ filename: string; format: "docx" | "pdf" }>;
	  }
	| {
			edits: Array<
				| { blocks: DocumentBlock[]; type: "append_blocks" }
				| {
						find: string;
						replace: string;
						replaceAll: boolean;
						type: "replace_text";
				  }
				| { title: string; type: "set_title" }
			>;
			kind: "document_edit";
			outputs: Array<{ filename: string; format: "docx" | "pdf" }>;
			source: ArtifactSource;
	  }
	| {
			kind: "document_export";
			outputs: Array<{ filename: string; format: "pdf" }>;
			source: ArtifactSource;
	  }
	| {
			filename: string;
			kind: "spreadsheet_create";
			sheets: SpreadsheetSheet[];
	  }
	| {
			edits: Array<
				| {
						rows: SpreadsheetCellValue[][];
						sheet: string;
						type: "append_rows";
				  }
				| {
						cell: string;
						sheet: string;
						type: "set_cell";
						value: SpreadsheetCellValue;
				  }
				| { sheet: SpreadsheetSheet; type: "add_sheet" }
			>;
			filename: string;
			kind: "spreadsheet_edit";
			source: ArtifactSource;
	  }
	| {
			filename: string;
			kind: "presentation_create";
			presentation: PresentationSpec;
	  }
	| {
			edits: Array<
				| {
						afterSlide: number;
						slides: PresentationSlide[];
						type: "insert_slides";
				  }
				| {
						find: string;
						replace: string;
						replaceAll: boolean;
						type: "replace_text";
				  }
				| { slideNumbers: number[]; type: "delete_slides" }
			>;
			filename: string;
			kind: "presentation_edit";
			source: ArtifactSource;
	  }
	| {
			edits: Array<
				| { blocks: DocumentBlock[]; title: string; type: "append_pages" }
				| { pageNumbers: number[]; type: "delete_pages" | "reorder_pages" }
			>;
			filename: string;
			kind: "pdf_edit";
			source: ArtifactSource;
	  };
export declare const documentSpecSchema: z.ZodType<DocumentSpec>;
export declare const spreadsheetSheetSchema: z.ZodType<SpreadsheetSheet>;
export declare const presentationSpecSchema: z.ZodType<PresentationSpec>;
export declare const artifactAuthoringInputSchema: z.ZodType<ArtifactAuthoringInput>;
export declare const generatedArtifactSchema: z.ZodType<GeneratedArtifact>;
export declare const artifactToolOutputSchema: z.ZodType<ArtifactToolOutput>;

export type GeneratedArtifact = {
	filename: string;
	mediaType: string;
	providerMetadata: {
		graneri: {
			generatedBy: "ai";
			storageId: string;
		};
	};
	sizeBytes: number;
	url: string;
};
export type ArtifactToolOutput = { artifacts: GeneratedArtifact[] };

export declare const getArtifactFormatMediaType: (
	format: keyof typeof ARTIFACT_MEDIA_TYPES,
) => string;
export declare const parseArtifactToolOutput: (
	value: unknown,
) => ArtifactToolOutput | null;
