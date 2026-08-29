import { describe, expect, it, vi } from "vitest";
import {
	buildProjectNoteToolDefinitions,
	buildProjectNoteTools,
	PROJECT_NOTE_SEARCH_QUERY_MAX_LENGTH,
	PROJECT_NOTE_SEARCH_RESULT_LIMIT,
} from "../src/project-note-tools.mjs";
import { toolUiMetadata } from "../src/tool-ui-metadata.mjs";

describe("project note tools", () => {
	it("enforces bounded search and read input at the tool boundary", () => {
		const definitions = buildProjectNoteToolDefinitions({
			searchProjectNotes: vi.fn(),
			getProjectNote: vi.fn(),
		});
		const searchDefinition = definitions.find(
			(definition) => definition.name === "search_project_notes",
		);
		const readDefinition = definitions.find(
			(definition) => definition.name === "get_project_note",
		);

		expect(
			searchDefinition?.inputSchema.safeParse({
				query: "x".repeat(PROJECT_NOTE_SEARCH_QUERY_MAX_LENGTH + 1),
			}).success,
		).toBe(false);
		expect(
			searchDefinition?.inputSchema.safeParse({
				query: "roadmap",
				limit: PROJECT_NOTE_SEARCH_RESULT_LIMIT + 1,
			}).success,
		).toBe(false);
		expect(
			searchDefinition?.inputSchema.safeParse({
				query: "roadmap",
				limit: PROJECT_NOTE_SEARCH_RESULT_LIMIT,
			}).success,
		).toBe(true);
		expect(
			readDefinition?.inputSchema.safeParse({ noteId: "note-1", offset: -1 })
				.success,
		).toBe(false);
		expect(readDefinition?.policy).toMatchObject({
			access: "read",
			approval: "not_required",
			provider: "graneri-project",
		});
	});

	it("searches only through the project-scoped adapter", async () => {
		const searchProjectNotes = vi.fn(async () => ({
			hasMore: false,
			notes: [
				{
					noteId: "note-1",
					preview: "Release checklist",
					title: "Launch",
					updatedAt: 1,
				},
			],
		}));
		const tools = buildProjectNoteTools({
			searchProjectNotes,
			getProjectNote: vi.fn(),
		});

		const result = await tools.search_project_notes.execute?.({
			query: "release",
			limit: 5,
		});

		expect(searchProjectNotes).toHaveBeenCalledWith({
			query: "release",
			limit: 5,
		});
		expect(result).toMatchObject({
			hasMore: false,
			notes: [
				{
					noteId: "note-1",
					preview: "Release checklist",
					title: "Launch",
					updatedAt: 1,
				},
			],
		});
		expect(toolUiMetadata.search_project_notes).toMatchObject({
			icon: "search",
			running: "Searching project notes",
		});
	});

	it("reads project notes through the scoped adapter", async () => {
		const getProjectNote = vi.fn(async () => ({
			noteId: "note-1",
			nextOffset: null,
			text: "Full launch notes",
			title: "Launch",
			updatedAt: 2,
		}));
		const tools = buildProjectNoteTools({
			searchProjectNotes: vi.fn(),
			getProjectNote,
		});

		const result = await tools.get_project_note.execute?.({
			noteId: "note-1",
			offset: 16_000,
		});

		expect(getProjectNote).toHaveBeenCalledWith({
			noteId: "note-1",
			offset: 16_000,
		});
		expect(result).toMatchObject({
			noteId: "note-1",
			nextOffset: null,
			text: "Full launch notes",
			title: "Launch",
			updatedAt: 2,
		});
		expect(toolUiMetadata.get_project_note).toMatchObject({
			icon: "file-text",
			running: "Reading project note",
		});
	});
});
