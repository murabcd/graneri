import {
	PROJECT_NOTE_READ_CHUNK_LENGTH,
	PROJECT_NOTE_SEARCH_QUERY_MAX_LENGTH,
	PROJECT_NOTE_SEARCH_RESULT_LIMIT,
} from "@workspace/ai/project-note-tools";
import { ConvexError, type Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalQuery, query } from "./_generated/server";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import { clampWhitespace, createResourceAccess } from "./domain";

const MAX_PROJECT_NOTE_TITLE_LENGTH = 120;
const MAX_PROJECT_NOTE_PREVIEW_LENGTH = 500;

const projectNoteSummaryValidator = v.object({
	id: v.id("notes"),
	title: v.string(),
	preview: v.string(),
	updatedAt: v.number(),
});

const projectNoteSearchResultValidator = v.object({
	hasMore: v.boolean(),
	notes: v.array(projectNoteSummaryValidator),
});

const projectNoteContentValidator = v.object({
	id: v.id("notes"),
	title: v.string(),
	text: v.string(),
	nextOffset: v.union(v.number(), v.null()),
	updatedAt: v.number(),
});

const { requireTokenIdentifier } = createResourceAccess("chat project notes");

const clip = (value: string, maxLength: number) => {
	const normalized = value.trim();
	return normalized.length > maxLength
		? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
		: normalized;
};

const toProjectNoteSummary = (
	note: Doc<"notes">,
): Infer<typeof projectNoteSummaryValidator> => ({
	id: note._id,
	title: clip(note.title, MAX_PROJECT_NOTE_TITLE_LENGTH) || "New note",
	preview: clip(note.searchableText, MAX_PROJECT_NOTE_PREVIEW_LENGTH),
	updatedAt: note.updatedAt,
});

const toProjectNoteContent = (
	note: Doc<"notes">,
	offset: number,
): Infer<typeof projectNoteContentValidator> => {
	const text = note.searchableText.trim();
	const chunkEnd = Math.min(
		offset + PROJECT_NOTE_READ_CHUNK_LENGTH,
		text.length,
	);
	return {
		id: note._id,
		title: clip(note.title, MAX_PROJECT_NOTE_TITLE_LENGTH) || "New note",
		text: text.slice(offset, chunkEnd),
		nextOffset: chunkEnd < text.length ? chunkEnd : null,
		updatedAt: note.updatedAt,
	};
};

const resolveProjectNoteOffset = (offset: number | undefined) => {
	const resolvedOffset = offset ?? 0;
	if (!Number.isInteger(resolvedOffset) || resolvedOffset < 0) {
		throw new ConvexError({
			code: "INVALID_PROJECT_NOTE_OFFSET",
			message: "Project note offset must be a non-negative integer.",
		});
	}
	return resolvedOffset;
};

const getOwnedChatProject = async (
	ctx: QueryCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
) => {
	const chat = await getOwnedActiveChatById(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		chatId,
	);
	return chat?.projectId ?? null;
};

const searchProjectNotesForOwner = async (
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
	if (
		!searchQuery ||
		searchQuery.length > PROJECT_NOTE_SEARCH_QUERY_MAX_LENGTH
	) {
		throw new ConvexError({
			code: "INVALID_PROJECT_NOTE_SEARCH",
			message: `Project note search must be between 1 and ${PROJECT_NOTE_SEARCH_QUERY_MAX_LENGTH} characters.`,
		});
	}
	const projectId = await getOwnedChatProject(
		ctx,
		args.ownerTokenIdentifier,
		args.workspaceId,
		args.chatId,
	);
	if (!projectId) {
		return { hasMore: false, notes: [] };
	}
	const requestedLimit = args.limit ?? PROJECT_NOTE_SEARCH_RESULT_LIMIT;
	if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
		throw new ConvexError({
			code: "INVALID_PROJECT_NOTE_SEARCH",
			message: "Project note search limit must be a positive integer.",
		});
	}
	const limit = Math.min(PROJECT_NOTE_SEARCH_RESULT_LIMIT, requestedLimit);

	const [titleMatches, textMatches] = await Promise.all([
		ctx.db
			.query("notes")
			.withSearchIndex("search_title", (q) =>
				q
					.search("title", searchQuery)
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("projectId", projectId)
					.eq("isArchived", false),
			)
			.take(limit + 1),
		ctx.db
			.query("notes")
			.withSearchIndex("search_text", (q) =>
				q
					.search("searchableText", searchQuery)
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("projectId", projectId)
					.eq("isArchived", false),
			)
			.take(limit + 1),
	]);
	const notesById = new Map<Id<"notes">, Doc<"notes">>();
	for (const note of [...titleMatches, ...textMatches]) {
		if (notesById.size === limit + 1) {
			break;
		}
		notesById.set(note._id, note);
	}

	return {
		hasMore: notesById.size > limit,
		notes: [...notesById.values()].slice(0, limit).map(toProjectNoteSummary),
	};
};

const getProjectNoteForOwner = async (
	ctx: QueryCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		chatId: string;
		noteId: Id<"notes">;
		offset?: number;
	},
) => {
	const projectId = await getOwnedChatProject(
		ctx,
		args.ownerTokenIdentifier,
		args.workspaceId,
		args.chatId,
	);
	if (!projectId) {
		return null;
	}
	const note = await ctx.db.get(args.noteId);
	if (
		!note ||
		note.isArchived ||
		note.ownerTokenIdentifier !== args.ownerTokenIdentifier ||
		note.workspaceId !== args.workspaceId ||
		note.projectId !== projectId
	) {
		return null;
	}

	return toProjectNoteContent(note, resolveProjectNoteOffset(args.offset));
};

export const search = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		searchQuery: v.string(),
		limit: v.optional(v.number()),
	},
	returns: projectNoteSearchResultValidator,
	handler: async (ctx, args) =>
		await searchProjectNotesForOwner(ctx, {
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
	returns: v.union(projectNoteContentValidator, v.null()),
	handler: async (ctx, args) => {
		const noteId = ctx.db.normalizeId("notes", args.noteId);
		if (!noteId) {
			return null;
		}
		return await getProjectNoteForOwner(ctx, {
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
	returns: projectNoteSearchResultValidator,
	handler: searchProjectNotesForOwner,
});

export const getForOwner = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		noteId: v.string(),
		offset: v.optional(v.number()),
	},
	returns: v.union(projectNoteContentValidator, v.null()),
	handler: async (ctx, args) => {
		const noteId = ctx.db.normalizeId("notes", args.noteId);
		if (!noteId) {
			return null;
		}
		return await getProjectNoteForOwner(ctx, { ...args, noteId });
	},
});
