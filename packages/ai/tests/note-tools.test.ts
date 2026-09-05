import { describe, expect, it, vi } from "vitest";
import {
	buildNoteToolDefinitions,
	buildNoteTools,
	NOTE_SEARCH_QUERY_MAX_LENGTH,
	NOTE_SEARCH_RESULT_LIMIT,
} from "../src/note-tools.mjs";
import { toolUiMetadata } from "../src/tool-ui-metadata.mjs";

describe("note tools", () => {
	it("enforces bounded search and read input at the tool boundary", () => {
		const definitions = buildNoteToolDefinitions({
			searchNotes: vi.fn(),
			getNote: vi.fn(),
		});
		const searchDefinition = definitions.find(
			(definition) => definition.name === "search_notes",
		);
		const readDefinition = definitions.find(
			(definition) => definition.name === "get_note",
		);

		expect(
			searchDefinition?.inputSchema.safeParse({
				query: "x".repeat(NOTE_SEARCH_QUERY_MAX_LENGTH + 1),
			}).success,
		).toBe(false);
		expect(
			searchDefinition?.inputSchema.safeParse({
				query: "roadmap",
				limit: NOTE_SEARCH_RESULT_LIMIT + 1,
			}).success,
		).toBe(false);
		expect(
			searchDefinition?.inputSchema.safeParse({
				query: "roadmap",
				limit: NOTE_SEARCH_RESULT_LIMIT,
			}).success,
		).toBe(true);
		expect(
			readDefinition?.inputSchema.safeParse({ noteId: "note-1", offset: -1 })
				.success,
		).toBe(false);
		expect(readDefinition?.policy).toMatchObject({
			access: "read",
			approval: "not_required",
			provider: "graneri-notes",
		});
	});

	it("searches only through the chat-scoped adapter", async () => {
		const searchNotes = vi.fn(async () => ({
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
		const tools = buildNoteTools({
			searchNotes,
			getNote: vi.fn(),
		});

		const result = await tools.search_notes.execute?.({
			query: "release",
			limit: 5,
		});

		expect(searchNotes).toHaveBeenCalledWith({
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
		expect(toolUiMetadata.search_notes).toMatchObject({
			icon: "search",
			running: "Searching notes",
		});
	});

	it("reads notes through the scoped adapter", async () => {
		const getNote = vi.fn(async () => ({
			noteId: "note-1",
			nextOffset: null,
			text: "Full launch notes",
			title: "Launch",
			updatedAt: 2,
		}));
		const tools = buildNoteTools({
			searchNotes: vi.fn(),
			getNote,
		});

		const result = await tools.get_note.execute?.({
			noteId: "note-1",
			offset: 16_000,
		});

		expect(getNote).toHaveBeenCalledWith({
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
		expect(toolUiMetadata.get_note).toMatchObject({
			icon: "file-text",
			running: "Reading note",
		});
	});
});
