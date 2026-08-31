import type { OptimisticLocalStore } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

type NotePatcher = <T extends Doc<"notes">>(note: T) => T;

export function optimisticPatchNote(
	localStore: OptimisticLocalStore,
	workspaceId: Id<"workspaces">,
	noteId: Id<"notes">,
	patchNote: NotePatcher,
) {
	const noteQueries = [api.notes.list, api.notes.listArchived] as const;

	for (const noteQuery of noteQueries) {
		const notes = localStore.getQuery(noteQuery, { workspaceId });
		if (notes === undefined) {
			continue;
		}

		localStore.setQuery(
			noteQuery,
			{ workspaceId },
			notes.map((note) => (note._id === noteId ? patchNote(note) : note)),
		);
	}

	const activeNote = localStore.getQuery(api.notes.get, {
		workspaceId,
		id: noteId,
	});
	if (activeNote) {
		localStore.setQuery(
			api.notes.get,
			{ workspaceId, id: noteId },
			patchNote(activeNote),
		);
	}

	const latestNote = localStore.getQuery(api.notes.getLatest, { workspaceId });
	if (latestNote?._id === noteId) {
		localStore.setQuery(
			api.notes.getLatest,
			{ workspaceId },
			patchNote(latestNote),
		);
	}
}
