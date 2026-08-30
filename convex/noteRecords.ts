import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { type parseNoteDocument, syncNoteDocumentState } from "./noteDocument";

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
		content: args.document.content,
		searchableText: args.searchableText,
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
	await syncNoteDocumentState({
		ctx,
		note,
		revisionId: null,
		document: args.document,
	});

	return noteId;
};
