import { v } from "convex/values";
import { query } from "./_generated/server";
import { createResourceAccess, requireOwnedWorkspace } from "./domain";
import { requirePersistedNoteDocument } from "./noteDocument";

const { requireIdentity } = createResourceAccess("notes");

const MAX_RESULTS_PER_SOURCE = 20;
const MAX_RESULTS = 30;

const searchResultValidator = v.object({
	id: v.string(),
	kind: v.union(v.literal("note"), v.literal("chat")),
	title: v.string(),
	projectName: v.optional(v.string()),
	preview: v.optional(v.string()),
	updatedAt: v.number(),
});

type SearchResult = {
	id: string;
	kind: "note" | "chat";
	title: string;
	projectName?: string;
	preview?: string;
	updatedAt: number;
};

export const command = query({
	args: {
		workspaceId: v.id("workspaces"),
		query: v.string(),
		kind: v.optional(v.union(v.literal("notes"), v.literal("chats"))),
		titleOnly: v.optional(v.boolean()),
	},
	returns: v.array(searchResultValidator),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const queryText = args.query.trim();

		if (!queryText) {
			return [];
		}
		const kind = args.kind ?? "notes";

		if (kind === "chats") {
			const [chatsByTitle, chatsByPreview] = await Promise.all([
				ctx.db
					.query("chats")
					.withSearchIndex("search_title", (q) =>
						q
							.search("title", queryText)
							.eq("ownerTokenIdentifier", ownerTokenIdentifier)
							.eq("workspaceId", args.workspaceId)
							.eq("isArchived", false),
					)
					.take(MAX_RESULTS_PER_SOURCE),
				args.titleOnly
					? []
					: ctx.db
							.query("chats")
							.withSearchIndex("search_preview", (q) =>
								q
									.search("preview", queryText)
									.eq("ownerTokenIdentifier", ownerTokenIdentifier)
									.eq("workspaceId", args.workspaceId)
									.eq("isArchived", false),
							)
							.take(MAX_RESULTS_PER_SOURCE),
			]);
			const results = new Map<string, SearchResult>();

			for (const chat of [...chatsByTitle, ...chatsByPreview]) {
				results.set(`chat:${chat.chatId}`, {
					id: chat.chatId,
					kind: "chat",
					title: chat.title || "New chat",
					preview: chat.preview.trim() || undefined,
					updatedAt: chat.updatedAt,
				});
			}

			return [...results.values()]
				.sort((left, right) => right.updatedAt - left.updatedAt)
				.slice(0, MAX_RESULTS);
		}

		const [notesByTitle, documentsByText] = await Promise.all([
			ctx.db
				.query("notes")
				.withSearchIndex("search_title", (q) =>
					q
						.search("title", queryText)
						.eq("ownerTokenIdentifier", ownerTokenIdentifier)
						.eq("workspaceId", args.workspaceId)
						.eq("isArchived", false),
				)
				.take(MAX_RESULTS_PER_SOURCE),
			args.titleOnly
				? []
				: ctx.db
						.query("noteDocuments")
						.withSearchIndex("search_text", (q) =>
							q
								.search("searchableText", queryText)
								.eq("ownerTokenIdentifier", ownerTokenIdentifier)
								.eq("workspaceId", args.workspaceId)
								.eq("isArchived", false),
						)
						.take(MAX_RESULTS_PER_SOURCE),
		]);
		const [textMatchedNotes, titleMatchedDocuments] = await Promise.all([
			Promise.all(documentsByText.map((document) => ctx.db.get(document.noteId))),
			Promise.all(
				notesByTitle.map((note) =>
					requirePersistedNoteDocument(ctx, note._id),
				),
			),
		]);
		const notesById = new Map(notesByTitle.map((note) => [note._id, note]));
		for (const note of textMatchedNotes) {
			if (
				note &&
				note.ownerTokenIdentifier === ownerTokenIdentifier &&
				note.workspaceId === args.workspaceId &&
				!note.isArchived
			) {
				notesById.set(note._id, note);
			}
		}
		const documentsByNoteId = new Map(
			documentsByText.map((document) => [document.noteId, document]),
		);
		for (const document of titleMatchedDocuments) {
			documentsByNoteId.set(document.noteId, document);
		}

		const projectIds = [
			...new Set(
				[...notesById.values()]
					.map((note) => note.projectId)
					.filter((projectId) => projectId !== undefined),
			),
		];
		const projects = await Promise.all(
			projectIds.map((projectId) => ctx.db.get(projectId)),
		);
		const projectNamesById = new Map<string, string>();

		for (const project of projects) {
			if (
				project &&
				project.ownerTokenIdentifier === ownerTokenIdentifier &&
				project.workspaceId === args.workspaceId
			) {
				projectNamesById.set(project._id, project.name);
			}
		}
		const results = new Map<string, SearchResult>();

		for (const note of notesById.values()) {
			const document = documentsByNoteId.get(note._id);
			if (!document) {
				throw new Error("Persisted note document is unavailable.");
			}
			results.set(`note:${note._id}`, {
				id: note._id,
				kind: "note",
				title: note.title.trim() || "New note",
				projectName: note.projectId
					? projectNamesById.get(note.projectId)
					: undefined,
				preview: document.searchableText.trim() || undefined,
				updatedAt: note.updatedAt,
			});
		}

		return [...results.values()]
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.slice(0, MAX_RESULTS);
	},
});
