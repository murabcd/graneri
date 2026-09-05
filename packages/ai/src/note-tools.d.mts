import type { ToolSet } from "ai";
import type { AiToolDefinition } from "./ai-tool-definition.mjs";

export declare const NOTE_SEARCH_QUERY_MAX_LENGTH: 320;
export declare const NOTE_SEARCH_RESULT_LIMIT: 8;
export declare const NOTE_READ_CHUNK_LENGTH: 16000;

export type NoteSearchInput = {
	query: string;
	limit?: number;
};

export type NoteSearchResult = {
	hasMore: boolean;
	notes: Array<{
		noteId: string;
		preview: string;
		title: string;
		updatedAt: number;
	}>;
};

export type NoteReadResult = {
	noteId: string;
	nextOffset: number | null;
	text: string;
	title: string;
	updatedAt: number;
} | null;

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
