import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { createResourceAccess, requireOwnedWorkspace } from "./domain";
import { requirePersistedNoteDocument } from "./noteDocument";
import { MAX_RETAINED_NOTE_REVISIONS } from "./noteVersionPolicy";

const noteVersionMetadataFields = {
	id: v.union(v.id("noteRevisions"), v.literal("current")),
	isCurrent: v.boolean(),
	authorName: v.string(),
	title: v.string(),
	createdAt: v.number(),
};

const noteVersionMetadataValidator = v.object(noteVersionMetadataFields);

const noteVersionValidator = v.object({
	...noteVersionMetadataFields,
	content: v.string(),
	searchableText: v.string(),
});

const { requireTokenIdentifier } = createResourceAccess("noteVersions");

const getOwnedActiveNote = async (
	ctx: QueryCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	noteId: Id<"notes">,
) => {
	await requireOwnedWorkspace(ctx, ownerTokenIdentifier, workspaceId);
	const note = await ctx.db.get(noteId);
	return note &&
		note.ownerTokenIdentifier === ownerTokenIdentifier &&
		note.workspaceId === workspaceId &&
		!note.isArchived
		? note
		: null;
};

export const list = query({
	args: {
		id: v.id("notes"),
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(noteVersionMetadataValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const note = await getOwnedActiveNote(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.id,
		);
		if (!note) {
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
			.take(MAX_RETAINED_NOTE_REVISIONS);

		return [
			{
				id: "current" as const,
				isCurrent: true,
				authorName: note.authorName ?? "",
				title: note.title,
				createdAt: note.updatedAt,
			},
			...revisions.map((revision) => ({
				id: revision._id,
				isCurrent: false,
				authorName: revision.authorName,
				title: revision.title,
				createdAt: revision.createdAt,
			})),
		];
	},
});

export const get = query({
	args: {
		id: v.id("notes"),
		versionId: v.union(v.id("noteRevisions"), v.literal("current")),
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(noteVersionValidator, v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const note = await getOwnedActiveNote(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.id,
		);
		if (!note) {
			return null;
		}

		if (args.versionId === "current") {
			const document = await requirePersistedNoteDocument(ctx, note._id);
			return {
				id: "current" as const,
				isCurrent: true,
				authorName: note.authorName ?? "",
				title: note.title,
				content: document.content,
				searchableText: document.searchableText,
				createdAt: note.updatedAt,
			};
		}

		const revision = await ctx.db.get(args.versionId);
		if (
			!revision ||
			revision.ownerTokenIdentifier !== ownerTokenIdentifier ||
			revision.workspaceId !== args.workspaceId ||
			revision.noteId !== args.id
		) {
			return null;
		}

		return {
			id: revision._id,
			isCurrent: false,
			authorName: revision.authorName,
			title: revision.title,
			content: revision.content,
			searchableText: revision.searchableText,
			createdAt: revision.createdAt,
		};
	},
});
