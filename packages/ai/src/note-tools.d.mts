import type { ToolSet } from "ai";
import type { z } from "zod";
import type { AiToolDefinition } from "./ai-tool-definition.mjs";

export declare const NOTE_SEARCH_QUERY_MAX_LENGTH: 320;
export declare const NOTE_SEARCH_RESULT_LIMIT: 8;
export declare const NOTE_READ_CHUNK_LENGTH: 16000;

export type NoteSearchInput = {
	query: string;
	limit?: number;
};

export declare const projectContextSchema: z.ZodType<{
	projectId: string;
	name: string;
	description: string;
}>;
export type ProjectContext = z.infer<typeof projectContextSchema>;
export declare const noteReferenceSchema: z.ZodType<{
	noteId: string;
	title: string;
}>;
export type NoteReference = z.infer<typeof noteReferenceSchema>;
export declare const noteSummarySchema: z.ZodType<
	NoteReference & {
		project: ProjectContext | null;
		preview: string;
		updatedAt: number;
	}
>;
export declare const noteReadSchema: z.ZodType<
	Omit<z.infer<typeof noteSummarySchema>, "preview"> & {
		text: string;
		nextOffset: number | null;
	}
>;
export declare const noteSearchSchema: z.ZodType<{
	hasMore: boolean;
	notes: z.infer<typeof noteSummarySchema>[];
}>;
export type NoteSearchResult = z.infer<typeof noteSearchSchema>;
export type NoteReadResult = z.infer<typeof noteReadSchema> | null;

type NoteToolAdapters = {
	getNote: (input: {
		noteId: string;
		offset?: number;
	}) => Promise<NoteReadResult>;
	searchNotes: (input: NoteSearchInput) => Promise<NoteSearchResult>;
};

export declare function buildNoteToolDefinitions(
	args: NoteToolAdapters,
): AiToolDefinition[];

export declare function buildNoteTools(args: NoteToolAdapters): ToolSet;
