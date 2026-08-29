import type { ToolSet } from "ai";
import type { AiToolDefinition } from "./ai-tool-definition.mjs";

export declare const PROJECT_NOTE_SEARCH_QUERY_MAX_LENGTH: 320;
export declare const PROJECT_NOTE_SEARCH_RESULT_LIMIT: 8;
export declare const PROJECT_NOTE_READ_CHUNK_LENGTH: 16000;

export type ProjectNoteSearchInput = {
	query: string;
	limit?: number;
};

export type ProjectNoteSearchResult = {
	hasMore: boolean;
	notes: Array<{
		noteId: string;
		preview: string;
		title: string;
		updatedAt: number;
	}>;
};

export type ProjectNoteReadResult = {
	noteId: string;
	nextOffset: number | null;
	text: string;
	title: string;
	updatedAt: number;
} | null;

type ProjectNoteToolAdapters = {
	getProjectNote: (input: {
		noteId: string;
		offset?: number;
	}) => Promise<ProjectNoteReadResult>;
	searchProjectNotes: (
		input: ProjectNoteSearchInput,
	) => Promise<ProjectNoteSearchResult>;
};

export declare function buildProjectNoteToolDefinitions(
	args: ProjectNoteToolAdapters,
): AiToolDefinition[];

export declare function buildProjectNoteTools(
	args: ProjectNoteToolAdapters,
): ToolSet;
