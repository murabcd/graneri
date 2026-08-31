import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import {
	createCalendarNoteRelationships,
	getCalendarEventKey,
	removeCalendarNoteRelationships,
	setCalendarNoteRelationshipsArchived,
} from "./calendarNoteRelationships";
import {
	calendarEventSnapshotValidator,
	upcomingCalendarEventValidator,
} from "./calendarValidators";
import {
	createResourceAccess,
	getAuthorName,
	requireOwnedWorkspace,
} from "./domain";
import {
	getOwnedNoteAttachment,
	removeNoteAttachmentDocumentReferences,
	removeNoteAttachments,
} from "./noteAttachmentReferences";
import {
	commitCurrentNoteDocument,
	parseNoteDocument,
	removePersistedNoteDocument,
	syncNoteDocumentState,
} from "./noteDocument";
import {
	removeAllNoteImages,
	removeNoteImageReferences,
} from "./noteImageReferences";
import { insertNote } from "./noteRecords";
import { requireOwnedProject } from "./projects";

const noteVisibilityValidator = v.union(
	v.literal("private"),
	v.literal("public"),
);

const noteFields = {
	_id: v.id("notes"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	projectId: v.optional(v.id("projects")),
	calendarEvent: v.optional(calendarEventSnapshotValidator),
	authorName: v.optional(v.string()),
	isStarred: v.optional(v.boolean()),
	starredSortOrder: v.number(),
	title: v.string(),
	templateSlug: v.optional(v.string()),
	content: v.string(),
	searchableText: v.string(),
	visibility: noteVisibilityValidator,
	shareId: v.optional(v.string()),
	sharedAt: v.optional(v.number()),
	isArchived: v.boolean(),
	archivedAt: v.optional(v.number()),
	createdAt: v.number(),
	updatedAt: v.number(),
};

const noteValidator = v.object(noteFields);

const sharedNoteValidator = v.object({
	...noteFields,
	isOwner: v.boolean(),
});

const noteChatContextValidator = v.object({
	id: v.id("notes"),
	title: v.string(),
	searchableText: v.string(),
});

const noteAttachmentValidator = v.object({
	id: v.id("noteAttachmentReferences"),
	filename: v.string(),
	mediaType: v.string(),
	sizeBytes: v.number(),
	storageId: v.id("_storage"),
	url: v.string(),
});

const removeAllNotesResultValidator = v.object({
	deletedCount: v.number(),
	hasMore: v.boolean(),
});

type RemoveAllNotesResult = {
	deletedCount: number;
	hasMore: boolean;
};

const MAX_CHAT_CONTEXT_NOTES = 20;
const MAX_NOTE_REVISIONS = 50;
const NOTE_REVISION_INTERVAL_MS = 30_000;

const noteVersionValidator = v.object({
	id: v.union(v.id("noteRevisions"), v.literal("current")),
	isCurrent: v.boolean(),
	authorName: v.string(),
	title: v.string(),
	content: v.string(),
	searchableText: v.string(),
	createdAt: v.number(),
});

const { requireIdentity, requireTokenIdentifier } =
	createResourceAccess("notes");

const normalizeNote = (note: Doc<"notes">) => ({
	...note,
	isStarred: note.isStarred ?? false,
	templateSlug: note.templateSlug,
	visibility: note.visibility ?? "private",
});

const getNotesByArchivedState = async (
	ctx: QueryCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	isArchived: boolean,
) =>
	await ctx.db
		.query("notes")
		.withIndex("by_owner_ws_arch_upd", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("isArchived", isArchived),
		)
		.order("desc")
		.take(100);

export const ensureOwnedNote = ({
	note,
	ownerTokenIdentifier,
	workspaceId,
}: {
	note: Doc<"notes"> | null;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
}) => {
	if (!note) {
		throw new ConvexError({
			code: "NOTE_NOT_FOUND",
			message: "Note not found.",
		});
	}

	if (
		note.ownerTokenIdentifier !== ownerTokenIdentifier ||
		note.workspaceId !== workspaceId
	) {
		throw new ConvexError({
			code: "UNAUTHORIZED",
			message: "You do not have access to this note.",
		});
	}

	return note;
};

export const requireOwnedNote = async (
	ctx: QueryCtx | MutationCtx,
	id: Doc<"notes">["_id"],
	workspaceId: Id<"workspaces">,
) => {
	const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
	await requireOwnedWorkspace(ctx, ownerTokenIdentifier, workspaceId);

	return ensureOwnedNote({
		note: await ctx.db.get(id),
		ownerTokenIdentifier,
		workspaceId,
	});
};

const createShareId = () => crypto.randomUUID().replaceAll("-", "");

const pruneNoteRevisions = async ({
	ctx,
	ownerTokenIdentifier,
	workspaceId,
	noteId,
	preserveRevisionId,
}: {
	ctx: MutationCtx;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
	noteId: Id<"notes">;
	preserveRevisionId?: Id<"noteRevisions">;
}) => {
	const revisions = await ctx.db
		.query("noteRevisions")
		.withIndex("by_owner_ws_note_createdAt", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("noteId", noteId),
		)
		.order("desc")
		.take(MAX_NOTE_REVISIONS + 1);

	const revisionsToPrune = [...revisions]
		.reverse()
		.filter((revision) => revision._id !== preserveRevisionId)
		.slice(0, Math.max(0, revisions.length - MAX_NOTE_REVISIONS));

	for (const revision of revisionsToPrune) {
		await removeNoteAttachmentDocumentReferences({
			ctx,
			noteId,
			revisionId: revision._id,
		});
		await removeNoteImageReferences({
			ctx,
			noteId,
			revisionId: revision._id,
		});
		await ctx.db.delete(revision._id);
	}
};

const createNoteRevision = async ({
	ctx,
	note,
	now,
	preserveRevisionId,
}: {
	ctx: MutationCtx;
	note: Doc<"notes">;
	now: number;
	preserveRevisionId?: Id<"noteRevisions">;
}) => {
	const revisionId = await ctx.db.insert("noteRevisions", {
		ownerTokenIdentifier: note.ownerTokenIdentifier,
		workspaceId: note.workspaceId,
		noteId: note._id,
		authorName: note.authorName ?? "",
		title: note.title,
		content: note.content,
		searchableText: note.searchableText,
		createdAt: now,
	});
	await syncNoteDocumentState({
		ctx,
		note,
		revisionId,
		document: parseNoteDocument(note.content),
	});

	await pruneNoteRevisions({
		ctx,
		ownerTokenIdentifier: note.ownerTokenIdentifier,
		workspaceId: note.workspaceId,
		noteId: note._id,
		preserveRevisionId,
	});
};

const maybeCreateNoteRevision = async ({
	ctx,
	note,
	now,
}: {
	ctx: MutationCtx;
	note: Doc<"notes">;
	now: number;
}) => {
	const latestRevision = await ctx.db
		.query("noteRevisions")
		.withIndex("by_owner_ws_note_createdAt", (q) =>
			q
				.eq("ownerTokenIdentifier", note.ownerTokenIdentifier)
				.eq("workspaceId", note.workspaceId)
				.eq("noteId", note._id),
		)
		.order("desc")
		.first();

	if (
		latestRevision &&
		now - latestRevision.createdAt < NOTE_REVISION_INTERVAL_MS
	) {
		return;
	}

	await createNoteRevision({ ctx, note, now });
};

const removeNoteRevisions = async ({
	ctx,
	ownerTokenIdentifier,
	noteId,
}: {
	ctx: MutationCtx;
	ownerTokenIdentifier: string;
	noteId: Id<"notes">;
}) => {
	const revisions = await ctx.db
		.query("noteRevisions")
		.withIndex("by_ownerTokenIdentifier_and_noteId", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier).eq("noteId", noteId),
		)
		.take(MAX_NOTE_REVISIONS);

	for (const revision of revisions) {
		await removeNoteAttachmentDocumentReferences({
			ctx,
			noteId,
			revisionId: revision._id,
		});
		await removeNoteImageReferences({
			ctx,
			noteId,
			revisionId: revision._id,
		});
		await ctx.db.delete(revision._id);
	}
};

const deleteNoteCascade = async (ctx: MutationCtx, note: Doc<"notes">) => {
	await ctx.runMutation(internal.resourceRetirement.retireChatsForNote, {
		ownerTokenIdentifier: note.ownerTokenIdentifier,
		workspaceId: note.workspaceId,
		noteId: note._id,
	});
	await ctx.scheduler.runAfter(0, internal.transcriptSessions.removeForNote, {
		noteId: note._id,
		ownerTokenIdentifier: note.ownerTokenIdentifier,
	});
	await ctx.runMutation(internal.noteComments.removeForNote, {
		ownerTokenIdentifier: note.ownerTokenIdentifier,
		workspaceId: note.workspaceId,
		noteId: note._id,
	});
	await removeNoteRevisions({
		ctx,
		ownerTokenIdentifier: note.ownerTokenIdentifier,
		noteId: note._id,
	});
	await removeNoteImageReferences({
		ctx,
		noteId: note._id,
		revisionId: null,
	});
	await removeNoteAttachmentDocumentReferences({
		ctx,
		noteId: note._id,
		revisionId: null,
	});
	await removeAllNoteImages(ctx, note);
	await removeNoteAttachments(ctx, note._id);
	await removeCalendarNoteRelationships(ctx, note);
	await removePersistedNoteDocument(ctx, note._id);
	await ctx.db.delete(note._id);
};

export const retireNoteRecord = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const note = await ctx.db.get(args.noteId);

		if (
			note &&
			note.ownerTokenIdentifier === args.ownerTokenIdentifier &&
			note.workspaceId === args.workspaceId
		) {
			await deleteNoteCascade(ctx, note);
		}

		return null;
	},
});

export const getLatest = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(noteValidator, v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const note = await ctx.db
			.query("notes")
			.withIndex("by_owner_ws_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("isArchived", false),
			)
			.order("desc")
			.first();

		return note ? normalizeNote(note) : null;
	},
});

export const list = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(noteValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const notes = await getNotesByArchivedState(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			false,
		);

		return notes.map(normalizeNote);
	},
});

export const listArchived = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(noteValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const notes = await getNotesByArchivedState(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			true,
		);

		return notes.map(normalizeNote);
	},
});

export const get = query({
	args: {
		id: v.id("notes"),
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(noteValidator, v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const note = await ctx.db.get(args.id);

		if (
			!note ||
			note.ownerTokenIdentifier !== ownerTokenIdentifier ||
			note.workspaceId !== args.workspaceId ||
			note.isArchived
		) {
			return null;
		}

		return normalizeNote(note);
	},
});

export const getAttachment = query({
	args: { id: v.string() },
	returns: v.union(noteAttachmentValidator, v.null()),
	handler: async (ctx, args) => {
		const noteAttachmentId = await ctx.db.normalizeId(
			"noteAttachmentReferences",
			args.id,
		);
		if (!noteAttachmentId) {
			return null;
		}
		const attachment = await getOwnedNoteAttachment(ctx, {
			noteAttachmentId,
			ownerTokenIdentifier: await requireTokenIdentifier(ctx),
		});
		return attachment
			? {
					id: attachment._id,
					filename: attachment.filename,
					mediaType: attachment.mediaType,
					sizeBytes: attachment.sizeBytes,
					storageId: attachment.storageId,
					url: attachment.url,
				}
			: null;
	},
});

export const listVersions = query({
	args: {
		id: v.id("notes"),
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(noteVersionValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const note = await ctx.db.get(args.id);

		if (
			!note ||
			note.ownerTokenIdentifier !== ownerTokenIdentifier ||
			note.workspaceId !== args.workspaceId ||
			note.isArchived
		) {
			return [];
		}

		const revisions = await ctx.db
			.query("noteRevisions")
			.withIndex("by_owner_ws_note_createdAt", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("noteId", args.id),
			)
			.order("desc")
			.take(MAX_NOTE_REVISIONS);

		return [
			{
				id: "current" as const,
				isCurrent: true,
				authorName: note.authorName ?? "",
				title: note.title,
				content: note.content,
				searchableText: note.searchableText,
				createdAt: note.updatedAt,
			},
			...revisions.map((revision) => ({
				id: revision._id,
				isCurrent: false,
				authorName: revision.authorName,
				title: revision.title,
				content: revision.content,
				searchableText: revision.searchableText,
				createdAt: revision.createdAt,
			})),
		];
	},
});

export const restoreVersion = mutation({
	args: {
		id: v.id("notes"),
		workspaceId: v.id("workspaces"),
		revisionId: v.id("noteRevisions"),
	},
	returns: v.id("notes"),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const note = ensureOwnedNote({
			note: await ctx.db.get(args.id),
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
		});
		const revision = await ctx.db.get(args.revisionId);

		if (
			!revision ||
			revision.ownerTokenIdentifier !== ownerTokenIdentifier ||
			revision.workspaceId !== args.workspaceId ||
			revision.noteId !== args.id
		) {
			throw new ConvexError({
				code: "VERSION_NOT_FOUND",
				message: "Version not found.",
			});
		}

		const now = Date.now();
		const restoredDocument = parseNoteDocument(revision.content);

		await createNoteRevision({
			ctx,
			note,
			now,
			preserveRevisionId: revision._id,
		});
		await ctx.db.patch(args.id, {
			authorName: note.authorName ?? getAuthorName(identity),
			title: revision.title,
			content: restoredDocument.content,
			searchableText: revision.searchableText,
			isArchived: false,
			archivedAt: undefined,
			updatedAt: now,
		});
		await commitCurrentNoteDocument({
			ctx,
			note,
			document: restoredDocument,
			searchableText: revision.searchableText,
			now,
		});

		return args.id;
	},
});

export const normalizeId = query({
	args: {
		id: v.string(),
	},
	returns: v.union(v.id("notes"), v.null()),
	handler: async (ctx, args) => {
		return ctx.db.normalizeId("notes", args.id);
	},
});

export const getChatContext = query({
	args: {
		workspaceId: v.id("workspaces"),
		ids: v.array(v.id("notes")),
	},
	returns: v.array(noteChatContextValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const uniqueIds = [...new Set(args.ids)].slice(0, 20);
		const notes = await Promise.all(uniqueIds.map((id) => ctx.db.get(id)));

		return notes.flatMap((note) => {
			if (
				!note ||
				note.isArchived ||
				note.ownerTokenIdentifier !== ownerTokenIdentifier ||
				note.workspaceId !== args.workspaceId
			) {
				return [];
			}

			return [
				{
					id: note._id,
					title: note.title.trim() || "New note",
					searchableText: note.searchableText.trim(),
				},
			];
		});
	},
});

export const getWorkspaceChatContext = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(noteChatContextValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const notes = await ctx.db
			.query("notes")
			.withIndex("by_owner_ws_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("isArchived", false),
			)
			.order("desc")
			.take(MAX_CHAT_CONTEXT_NOTES);

		return notes.map((note) => ({
			id: note._id,
			title: note.title,
			searchableText: note.searchableText,
		}));
	},
});

export const getShared = query({
	args: {
		shareId: v.string(),
	},
	returns: v.union(sharedNoteValidator, v.null()),
	handler: async (ctx, args) => {
		const note = await ctx.db
			.query("notes")
			.withIndex("by_shareId", (q) => q.eq("shareId", args.shareId))
			.unique();

		if (!note || note.isArchived) {
			return null;
		}

		const normalizedNote = normalizeNote(note);

		const identity = await ctx.auth.getUserIdentity();
		const isOwner =
			identity?.tokenIdentifier === normalizedNote.ownerTokenIdentifier;

		if (normalizedNote.visibility !== "public" && !isOwner) {
			return null;
		}

		return {
			...normalizedNote,
			isOwner,
		};
	},
});

export const create = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		projectId: v.union(v.id("projects"), v.null()),
	},
	returns: v.id("notes"),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		if (args.projectId) {
			await requireOwnedProject(ctx, args.projectId, args.workspaceId);
		}
		const now = Date.now();
		const content = parseNoteDocument(
			JSON.stringify({
				type: "doc",
				content: [{ type: "paragraph" }],
			}),
		);

		return await insertNote(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			projectId: args.projectId ?? undefined,
			authorName: getAuthorName(identity),
			title: "",
			document: content,
			searchableText: "",
			now,
		});
	},
});

export const createFromCalendarEvent = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		calendarEvent: upcomingCalendarEventValidator,
		content: v.string(),
		searchableText: v.string(),
	},
	returns: v.id("notes"),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const authorName = getAuthorName(identity);
		const now = Date.now();
		const calendarEvent = args.calendarEvent;
		const calendarEventKey = getCalendarEventKey(calendarEvent);

		const existingNote = await ctx.db
			.query("notes")
			.withIndex("by_owner_ws_calendarEventKey_archived", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("calendarEvent.key", calendarEventKey)
					.eq("isArchived", false),
			)
			.unique();

		if (existingNote) {
			return existingNote._id;
		}
		const document = parseNoteDocument(args.content);

		const noteId = await insertNote(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			authorName,
			title: calendarEvent.title.trim(),
			document,
			searchableText: args.searchableText,
			now,
		});
		const calendarEventSnapshot = await createCalendarNoteRelationships({
			ctx,
			event: calendarEvent,
			noteId,
			now,
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
		});
		await ctx.db.patch(noteId, { calendarEvent: calendarEventSnapshot });
		return noteId;
	},
});

export const save = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.optional(v.id("notes")),
		title: v.string(),
		content: v.string(),
		searchableText: v.string(),
		templateSlug: v.optional(v.union(v.string(), v.null())),
	},
	returns: v.id("notes"),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const authorName = getAuthorName(identity);
		const now = Date.now();
		const document = parseNoteDocument(args.content);

		if (args.id) {
			const existing = ensureOwnedNote({
				note: await ctx.db.get(args.id),
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
			});
			const nextTemplateSlug =
				args.templateSlug === undefined
					? existing.templateSlug
					: (args.templateSlug ?? undefined);

			if (
				existing.title === args.title &&
				existing.content === document.content &&
				existing.searchableText === args.searchableText &&
				existing.templateSlug === nextTemplateSlug &&
				!existing.isArchived
			) {
				return args.id;
			}

			await maybeCreateNoteRevision({
				ctx,
				note: existing,
				now,
			});
			await commitCurrentNoteDocument({
				ctx,
				note: existing,
				document,
				searchableText: args.searchableText,
				now,
			});

			await ctx.db.patch(args.id, {
				authorName: existing.authorName ?? authorName,
				isStarred: existing.isStarred ?? false,
				starredSortOrder: existing.starredSortOrder,
				projectId: existing.projectId,
				title: args.title,
				content: document.content,
				searchableText: args.searchableText,
				visibility: existing.visibility ?? "private",
				templateSlug: nextTemplateSlug,
				shareId: existing.shareId,
				sharedAt: existing.sharedAt,
				isArchived: false,
				archivedAt: undefined,
				updatedAt: now,
			});

			return args.id;
		}

		return await insertNote(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			authorName,
			title: args.title,
			document,
			searchableText: args.searchableText,
			templateSlug: args.templateSlug ?? undefined,
			now,
		});
	},
});

export const setProject = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
		projectId: v.union(v.id("projects"), v.null()),
	},
	returns: v.object({
		projectId: v.union(v.id("projects"), v.null()),
	}),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		if (note.isArchived) {
			throw new ConvexError({
				code: "NOTE_NOT_FOUND",
				message: "Note not found.",
			});
		}

		if (args.projectId) {
			await requireOwnedProject(ctx, args.projectId, args.workspaceId);
		}

		const nextProjectId = args.projectId ?? undefined;
		if (note.projectId === nextProjectId) {
			return {
				projectId: args.projectId,
			};
		}

		await ctx.db.patch(args.id, {
			projectId: nextProjectId,
			updatedAt: Date.now(),
		});

		return {
			projectId: args.projectId,
		};
	},
});

export const rename = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
		title: v.string(),
	},
	returns: v.object({
		title: v.string(),
	}),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		if (note.isArchived) {
			throw new ConvexError({
				code: "NOTE_NOT_FOUND",
				message: "Note not found.",
			});
		}

		const title = args.title.trim();

		await ctx.db.patch(args.id, {
			title,
			updatedAt: Date.now(),
		});

		return { title };
	},
});

export const toggleStar = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
	},
	returns: v.object({
		isStarred: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		if (note.isArchived) {
			throw new ConvexError({
				code: "NOTE_NOT_FOUND",
				message: "Note not found.",
			});
		}

		const isStarred = !(note.isStarred ?? false);
		const now = Date.now();

		await ctx.db.patch(args.id, {
			isStarred,
			starredSortOrder: isStarred ? now : note.starredSortOrder,
			updatedAt: now,
		});

		return {
			isStarred,
		};
	},
});

export const updateVisibility = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
		visibility: noteVisibilityValidator,
	},
	returns: v.object({
		visibility: noteVisibilityValidator,
		shareId: v.optional(v.string()),
	}),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		if (note.isArchived) {
			throw new ConvexError({
				code: "NOTE_NOT_FOUND",
				message: "Note not found.",
			});
		}

		const shareId =
			args.visibility === "public"
				? (note.shareId ?? createShareId())
				: note.shareId;

		await ctx.db.patch(args.id, {
			visibility: args.visibility,
			shareId,
			sharedAt: args.visibility === "public" ? Date.now() : note.sharedAt,
			updatedAt: Date.now(),
		});

		return {
			visibility: args.visibility,
			shareId,
		};
	},
});

export const ensureShareId = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
	},
	returns: v.object({
		shareId: v.string(),
	}),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		if (note.isArchived) {
			throw new ConvexError({
				code: "NOTE_NOT_FOUND",
				message: "Note not found.",
			});
		}

		const shareId = note.shareId ?? createShareId();

		if (!note.shareId) {
			await ctx.db.patch(args.id, {
				shareId,
				updatedAt: Date.now(),
			});
		}

		return { shareId };
	},
});

export const moveToTrash = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		await ctx.db.patch(args.id, {
			isArchived: true,
			archivedAt: Date.now(),
			updatedAt: Date.now(),
		});
		await setCalendarNoteRelationshipsArchived({
			ctx,
			isArchived: true,
			note,
		});
		await ctx.runMutation(internal.chats.archiveForNote, {
			ownerTokenIdentifier: note.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			noteId: args.id,
		});

		return null;
	},
});

export const restore = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);

		await ctx.db.patch(args.id, {
			isArchived: false,
			archivedAt: undefined,
			updatedAt: Date.now(),
		});
		await setCalendarNoteRelationshipsArchived({
			ctx,
			isArchived: false,
			note,
		});
		await ctx.runMutation(internal.chats.restoreForNote, {
			ownerTokenIdentifier: note.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			noteId: args.id,
		});

		return null;
	},
});

export const remove = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		id: v.id("notes"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const note = await requireOwnedNote(ctx, args.id, args.workspaceId);
		await ctx.runMutation(internal.resourceRetirement.retireNote, {
			ownerTokenIdentifier: note.ownerTokenIdentifier,
			workspaceId: note.workspaceId,
			noteId: note._id,
		});

		return null;
	},
});

export const removeAll = mutation({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: removeAllNotesResultValidator,
	handler: async (ctx, args): Promise<RemoveAllNotesResult> => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const progress: { retiredCount: number; hasMore: boolean } =
			await ctx.runMutation(
				internal.resourceRetirement.retireNotesForWorkspace,
				{
					ownerTokenIdentifier,
					workspaceId: args.workspaceId,
				},
			);

		return {
			deletedCount: progress.retiredCount,
			hasMore: progress.hasMore,
		};
	},
});
