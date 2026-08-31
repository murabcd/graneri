import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
	commitCurrentNoteDocument,
	type parseNoteDocument,
	requirePersistedNoteDocument,
} from "./noteDocument";

const updateNoteDocumentProjection = async ({
	ctx,
	noteId,
	projectId,
	isArchived,
	updatedAt,
}: {
	ctx: MutationCtx;
	noteId: Id<"notes">;
	projectId: Id<"projects"> | undefined;
	isArchived: boolean;
	updatedAt: number;
}) => {
	const document = await requirePersistedNoteDocument(ctx, noteId);
	await ctx.db.patch(document._id, {
		projectId,
		isArchived,
		updatedAt,
	});
};

export const setNoteProject = async (
	ctx: MutationCtx,
	note: Doc<"notes">,
	projectId: Id<"projects"> | undefined,
	now: number,
) => {
	await ctx.db.patch(note._id, {
		projectId,
		updatedAt: now,
	});
	await updateNoteDocumentProjection({
		ctx,
		noteId: note._id,
		projectId,
		isArchived: note.isArchived,
		updatedAt: now,
	});
};

export const setNoteArchived = async (
	ctx: MutationCtx,
	note: Doc<"notes">,
	isArchived: boolean,
	now: number,
) => {
	await ctx.db.patch(note._id, {
		isArchived,
		archivedAt: isArchived ? now : undefined,
		updatedAt: now,
	});
	await updateNoteDocumentProjection({
		ctx,
		noteId: note._id,
		projectId: note.projectId,
		isArchived,
		updatedAt: now,
	});
};

export const insertNote = async (
	ctx: MutationCtx,
	args: {
		authorName: string;
		document: ReturnType<typeof parseNoteDocument>;
		now: number;
		ownerTokenIdentifier: string;
		projectId?: Id<"projects">;
		searchableText: string;
		templateSlug?: string;
		title: string;
		workspaceId: Id<"workspaces">;
	},
) => {
	const noteId = await ctx.db.insert("notes", {
		ownerTokenIdentifier: args.ownerTokenIdentifier,
		workspaceId: args.workspaceId,
		projectId: args.projectId,
		authorName: args.authorName,
		isStarred: false,
		starredSortOrder: args.now,
		title: args.title,
		templateSlug: args.templateSlug,
		visibility: "private",
		shareId: undefined,
		sharedAt: undefined,
		isArchived: false,
		archivedAt: undefined,
		createdAt: args.now,
		updatedAt: args.now,
	});
	const note = await ctx.db.get(noteId);
	if (!note) {
		throw new Error("Inserted note is unavailable.");
	}
	await commitCurrentNoteDocument({
		ctx,
		note,
		document: args.document,
		searchableText: args.searchableText,
		now: args.now,
	});

	return noteId;
};
