import type { OptimisticLocalStore } from "convex/browser";
import {
	insertAtTop,
	optimisticallyUpdateValueInPaginatedQuery,
} from "convex/react";
import type { NoteListItem } from "@/lib/note-types";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type NoteMapper = (note: NoteListItem) => NoteListItem;
type NotePredicate = (note: NoteListItem) => boolean;

export function mapOptimisticNoteCatalogs(
	localStore: OptimisticLocalStore,
	workspaceId: Id<"workspaces">,
	mapNote: NoteMapper,
) {
	optimisticallyUpdateValueInPaginatedQuery(
		localStore,
		api.notes.list,
		{ workspaceId },
		mapNote,
	);
	optimisticallyUpdateValueInPaginatedQuery(
		localStore,
		api.notes.listArchived,
		{ workspaceId },
		mapNote,
	);
}

export function removeOptimisticNotes(
	localStore: OptimisticLocalStore,
	options: {
		archived: boolean;
		shouldRemove: NotePredicate;
		workspaceId: Id<"workspaces">;
	},
): NoteListItem[] {
	return options.archived
		? removeArchivedNotes(localStore, options)
		: removeActiveNotes(localStore, options);
}

function removeActiveNotes(
	localStore: OptimisticLocalStore,
	options: {
		shouldRemove: NotePredicate;
		workspaceId: Id<"workspaces">;
	},
) {
	const removedNotes = new Map<Id<"notes">, NoteListItem>();
	for (const snapshot of localStore.getAllQueries(api.notes.list)) {
		if (
			snapshot.value === undefined ||
			snapshot.args.workspaceId !== options.workspaceId
		) {
			continue;
		}

		const page = snapshot.value.page.filter((note) => {
			if (!options.shouldRemove(note)) {
				return true;
			}
			removedNotes.set(note._id, note);
			return false;
		});
		localStore.setQuery(api.notes.list, snapshot.args, {
			...snapshot.value,
			page,
		});
	}
	return [...removedNotes.values()];
}

function removeArchivedNotes(
	localStore: OptimisticLocalStore,
	options: {
		shouldRemove: NotePredicate;
		workspaceId: Id<"workspaces">;
	},
) {
	const removedNotes = new Map<Id<"notes">, NoteListItem>();
	for (const snapshot of localStore.getAllQueries(api.notes.listArchived)) {
		if (
			snapshot.value === undefined ||
			snapshot.args.workspaceId !== options.workspaceId
		) {
			continue;
		}

		const page = snapshot.value.page.filter((note) => {
			if (!options.shouldRemove(note)) {
				return true;
			}
			removedNotes.set(note._id, note);
			return false;
		});
		localStore.setQuery(api.notes.listArchived, snapshot.args, {
			...snapshot.value,
			page,
		});
	}
	return [...removedNotes.values()];
}

export function insertOptimisticNote(
	localStore: OptimisticLocalStore,
	options: {
		archived: boolean;
		note: NoteListItem;
		workspaceId: Id<"workspaces">;
	},
) {
	if (options.archived) {
		insertAtTop({
			paginatedQuery: api.notes.listArchived,
			argsToMatch: { workspaceId: options.workspaceId },
			localQueryStore: localStore,
			item: options.note,
		});
		return;
	}

	insertAtTop({
		paginatedQuery: api.notes.list,
		argsToMatch: { workspaceId: options.workspaceId },
		localQueryStore: localStore,
		item: options.note,
	});
}
