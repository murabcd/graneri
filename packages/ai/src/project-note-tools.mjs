import { z } from "zod";
import { buildAiToolSet, defineAiTool } from "./ai-tool-definition.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

export const PROJECT_NOTE_SEARCH_QUERY_MAX_LENGTH = 320;
export const PROJECT_NOTE_SEARCH_RESULT_LIMIT = 8;
export const PROJECT_NOTE_READ_CHUNK_LENGTH = 16_000;

export const buildProjectNoteToolDefinitions = ({
	getProjectNote,
	searchProjectNotes,
}) => [
	defineAiTool({
		name: "search_project_notes",
		description:
			"Search notes in this chat's Graneri project. Use this before answering from project knowledge. Results are limited to the project attached to the chat; they never include workspace notes or desktop-folder files outside that project.",
		inputSchema: z.object({
			query: z.string().trim().min(1).max(PROJECT_NOTE_SEARCH_QUERY_MAX_LENGTH),
			limit: z
				.number()
				.int()
				.min(1)
				.max(PROJECT_NOTE_SEARCH_RESULT_LIMIT)
				.optional(),
		}),
		policy: {
			access: "read",
			approval: "not_required",
			capability: "search",
			provider: "graneri-project",
		},
		ui: toolUiMetadata.search_project_notes,
		execute: async (input) => await searchProjectNotes(input),
	}),
	defineAiTool({
		name: "get_project_note",
		description:
			"Read one note returned by search_project_notes in bounded chunks. The note must still belong to this chat's Graneri project; notes outside the project are unavailable. When nextOffset is not null, call this tool again with that offset to continue reading.",
		inputSchema: z.object({
			noteId: z.string().trim().min(1),
			offset: z.number().int().min(0).optional(),
		}),
		policy: {
			access: "read",
			approval: "not_required",
			capability: "read",
			provider: "graneri-project",
		},
		ui: toolUiMetadata.get_project_note,
		execute: async (input) => await getProjectNote(input),
	}),
];

export const buildProjectNoteTools = (args) =>
	buildAiToolSet(buildProjectNoteToolDefinitions(args));
