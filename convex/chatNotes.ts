import {
	NOTE_READ_CHUNK_LENGTH,
	NOTE_SEARCH_QUERY_MAX_LENGTH,
	NOTE_SEARCH_RESULT_LIMIT,
} from "@workspace/ai/note-tools";
import { ConvexError, type Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalQuery, query } from "./_generated/server";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import { clampWhitespace, createResourceAccess } from "./domain";
import { requirePersistedNoteDocument } from "./noteDocument";
import { getNoteProjectContext, projectContextValidator } from "./projects";

const MAX_NOTE_TITLE_LENGTH = 120;
const MAX_NOTE_PREVIEW_LENGTH = 500;

const noteSummaryValidator = v.object({
	noteId: v.id("notes"),
	title: v.string(),
	preview: v.string(),
	updatedAt: v.number(),
	project: v.union(projectContextValidator, v.null()),
});

const noteSearchResultValidator = v.object({
	hasMore: v.boolean(),
	notes: v.array(noteSummaryValidator),
});

const noteContentValidator = v.object({
	noteId: v.id("notes"),
	title: v.string(),
	text: v.string(),
	nextOffset: v.union(v.number(), v.null()),
	updatedAt: v.number(),
	project: v.union(projectContextValidator, v.null()),
});

const { requireTokenIdentifier } = createResourceAccess("chat notes");

const clip = (value: string, maxLength: number) => {
	const normalized = value.trim();
	return normalized.length > maxLength
		? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
		: normalized;
};

const toNoteSummary = (
	note: Doc<"notes">,
	document: Doc<"noteDocuments">,
	project: Infer<typeof projectContextValidator> | null,
): Infer<typeof noteSummaryValidator> => ({
	noteId: note._id,
	title: clip(note.title, MAX_NOTE_TITLE_LENGTH) || "New note",
	preview: clip(document.searchableText, MAX_NOTE_PREVIEW_LENGTH),
	updatedAt: note.updatedAt,
	project,
});

const toNoteContent = (
	note: Doc<"notes">,
	document: Doc<"noteDocuments">,
	offset: number,
	project: Infer<typeof projectContextValidator> | null,
): Infer<typeof noteContentValidator> => {
	const text = document.searchableText.trim();
	const chunkEnd = Math.min(offset + NOTE_READ_CHUNK_LENGTH, text.length);
	return {
		noteId: note._id,
		title: clip(note.title, MAX_NOTE_TITLE_LENGTH) || "New note",
		text: text.slice(offset, chunkEnd),
		nextOffset: chunkEnd < text.length ? chunkEnd : null,
		updatedAt: note.updatedAt,
		project,
	};
};

const resolveNoteOffset = (offset: number | undefined) => {
	const resolvedOffset = offset ?? 0;
	if (!Number.isInteger(resolvedOffset) || resolvedOffset < 0) {
		throw new ConvexError({
			code: "INVALID_NOTE_OFFSET",
			message: "Note offset must be a non-negative integer.",
		});
	}
	return resolvedOffset;
};

const searchNotesForOwner = async (
	ctx: QueryCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		chatId: string;
		searchQuery: string;
		limit?: number;
	},
) => {
	const searchQuery = clampWhitespace(args.searchQuery);
	if (!searchQuery || searchQuery.length > NOTE_SEARCH_QUERY_MAX_LENGTH) {
		throw new ConvexError({
			code: "INVALID_NOTE_SEARCH",
			message: `Note search must be between 1 and ${NOTE_SEARCH_QUERY_MAX_LENGTH} characters.`,
		});
	}
	const chat = await getOwnedActiveChatById(
		ctx,
		args.ownerTokenIdentifier,
		args.workspaceId,
		args.chatId,
	);
	if (!chat) {
		return { hasMore: false, notes: [] };
	}
	const requestedLimit = args.limit ?? NOTE_SEARCH_RESULT_LIMIT;
	if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
		throw new ConvexError({
			code: "INVALID_NOTE_SEARCH",
			message: "Note search limit must be a positive integer.",
		});
	}
	const limit = Math.min(NOTE_SEARCH_RESULT_LIMIT, requestedLimit);

	const [titleMatches, textMatches] = await Promise.all([
		ctx.db
			.query("notes")
			.withSearchIndex("search_title", (q) => {
				const search = q
					.search("title", searchQuery)
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("isArchived", false);
				return chat.projectId ? search.eq("projectId", chat.projectId) : search;
			})
			.take(limit + 1),
		ctx.db
			.query("noteDocuments")
			.withSearchIndex("search_text", (q) => {
				const search = q
					.search("searchableText", searchQuery)
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("isArchived", false);
				return chat.projectId ? search.eq("projectId", chat.projectId) : search;
			})
			.take(limit + 1),
	]);
	const [textMatchedNotes, titleMatchedDocuments] = await Promise.all([
		Promise.all(textMatches.map((document) => ctx.db.get(document.noteId))),
		Promise.all(
			titleMatches.map((note) => requirePersistedNoteDocument(ctx, note._id)),
		),
	]);
	const notesById = new Map(titleMatches.map((note) => [note._id, note]));
	for (const note of textMatchedNotes) {
		if (
			note &&
			note.ownerTokenIdentifier === args.ownerTokenIdentifier &&
			note.workspaceId === args.workspaceId &&
			(!chat.projectId || note.projectId === chat.projectId) &&
			!note.isArchived
		) {
			notesById.set(note._id, note);
		}
	}
	const documentsByNoteId = new Map(
		textMatches.map((document) => [document.noteId, document]),
	);
	for (const document of titleMatchedDocuments) {
		documentsByNoteId.set(document.noteId, document);
	}
	const records = [...notesById.values()]
		.flatMap((note) => {
			const document = documentsByNoteId.get(note._id);
			return document ? [{ document, note }] : [];
		})
		.slice(0, limit + 1);

	return {
		hasMore: records.length > limit,
		notes: await Promise.all(
			records
				.slice(0, limit)
				.map(async ({ document, note }) =>
					toNoteSummary(note, document, await getNoteProjectContext(ctx, note)),
				),
		),
	};
};

const getNoteForOwner = async (
	ctx: QueryCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		chatId: string;
		noteId: Id<"notes">;
		offset?: number;
	},
) => {
	const chat = await getOwnedActiveChatById(
		ctx,
		args.ownerTokenIdentifier,
		args.workspaceId,
		args.chatId,
	);
	if (!chat) {
		return null;
	}
	const note = await ctx.db.get(args.noteId);
	if (
		!note ||
		note.isArchived ||
		note.ownerTokenIdentifier !== args.ownerTokenIdentifier ||
		note.workspaceId !== args.workspaceId ||
		(chat.projectId !== null && note.projectId !== chat.projectId)
	) {
		return null;
	}

	const [document, project] = await Promise.all([
		requirePersistedNoteDocument(ctx, note._id),
		getNoteProjectContext(ctx, note),
	]);
	return toNoteContent(note, document, resolveNoteOffset(args.offset), project);
};

export const search = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		searchQuery: v.string(),
		limit: v.optional(v.number()),
	},
	returns: noteSearchResultValidator,
	handler: async (ctx, args) =>
		await searchNotesForOwner(ctx, {
			...args,
			ownerTokenIdentifier: await requireTokenIdentifier(ctx),
		}),
});

export const get = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		noteId: v.string(),
		offset: v.optional(v.number()),
	},
	returns: v.union(noteContentValidator, v.null()),
	handler: async (ctx, args) => {
		const noteId = ctx.db.normalizeId("notes", args.noteId);
		if (!noteId) {
			return null;
		}
		return await getNoteForOwner(ctx, {
			...args,
			noteId,
			ownerTokenIdentifier: await requireTokenIdentifier(ctx),
		});
	},
});

export const searchForOwner = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		searchQuery: v.string(),
		limit: v.optional(v.number()),
	},
	returns: noteSearchResultValidator,
	handler: searchNotesForOwner,
});

export const getForOwner = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		noteId: v.string(),
		offset: v.optional(v.number()),
	},
	returns: v.union(noteContentValidator, v.null()),
	handler: async (ctx, args) => {
		const noteId = ctx.db.normalizeId("notes", args.noteId);
		if (!noteId) {
			return null;
		}
		return await getNoteForOwner(ctx, { ...args, noteId });
	},
});
