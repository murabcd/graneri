import { z } from "zod";
import { buildAiToolSet, defineAiTool } from "./ai-tool-definition.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

export const NOTE_SEARCH_QUERY_MAX_LENGTH = 320;
export const NOTE_SEARCH_RESULT_LIMIT = 8;
export const NOTE_READ_CHUNK_LENGTH = 16_000;

export const projectContextSchema = z.object({
	projectId: z.string().min(1),
	name: z.string(),
	description: z.string(),
});

export const noteReferenceSchema = z.object({
	noteId: z.string().min(1),
	title: z.string(),
});

export const noteSummarySchema = noteReferenceSchema.extend({
	project: projectContextSchema.nullable(),
	preview: z.string(),
	updatedAt: z.number(),
});

export const noteReadSchema = noteSummarySchema.omit({ preview: true }).extend({
	text: z.string(),
	nextOffset: z.number().nullable(),
});

export const noteSearchSchema = z.object({
	hasMore: z.boolean(),
	notes: z.array(noteSummarySchema),
});

export const buildNoteToolDefinitions = ({ getNote, searchNotes }) => [
	defineAiTool({
		name: "search_notes",
		description:
			"Search the user's Graneri note titles and contents without requiring a note mention or attachment. Chats without a project search all of the user's active notes in the current workspace; chats attached to a project search only that project. This is keyword search, not semantic search. If no results match, retry with fewer keywords, synonyms, or relevant language variants before concluding there are no notes. Read relevant results with get_note before summarizing them.",
		inputSchema: z.object({
			query: z.string().trim().min(1).max(NOTE_SEARCH_QUERY_MAX_LENGTH),
			limit: z.number().int().min(1).max(NOTE_SEARCH_RESULT_LIMIT).optional(),
		}),
		policy: {
			access: "read",
			approval: "not_required",
			capability: "search",
			provider: "graneri-notes",
		},
		ui: toolUiMetadata.search_notes,
		execute: async (input) => await searchNotes(input),
	}),
	defineAiTool({
		name: "get_note",
		description:
			"Read one note returned by search_notes in bounded chunks, without requiring a note mention or attachment. The note must belong to the user's current workspace and, when this chat has a project, that project. When nextOffset is not null, call this tool again with that offset to continue reading.",
		inputSchema: z.object({
			noteId: z.string().trim().min(1),
			offset: z.number().int().min(0).optional(),
		}),
		policy: {
			access: "read",
			approval: "not_required",
			capability: "read",
			provider: "graneri-notes",
		},
		ui: toolUiMetadata.get_note,
		execute: async (input) => await getNote(input),
	}),
];

export const buildNoteTools = (args) =>
	buildAiToolSet(buildNoteToolDefinitions(args));
