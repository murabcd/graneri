import type { OptimisticLocalStore } from "convex/browser";
import { mapOptimisticNoteCatalogs } from "@/lib/optimistic-note-catalog";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

type NotePatcher = <T extends Doc<"notes">>(note: T) => T;

export function optimisticPatchNote(
	localStore: OptimisticLocalStore,
	workspaceId: Id<"workspaces">,
	noteId: Id<"notes">,
	patchNote: NotePatcher,
) {
	mapOptimisticNoteCatalogs(localStore, workspaceId, (note) =>
		note._id === noteId ? patchNote(note) : note,
	);

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
