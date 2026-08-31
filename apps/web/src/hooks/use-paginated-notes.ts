import { usePaginatedQuery } from "convex/react";
import * as React from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const NOTE_CATALOG_PAGE_SIZE = 30;

export function usePaginatedNotes(
	workspaceId: Id<"workspaces"> | null,
	options?: { archived?: boolean; enabled?: boolean },
) {
	const query = options?.archived ? api.notes.listArchived : api.notes.list;
	const enabled = options?.enabled ?? true;
	const pagination = usePaginatedQuery(
		query,
		workspaceId && enabled ? { workspaceId } : "skip",
		{ initialNumItems: NOTE_CATALOG_PAGE_SIZE },
	);
	const loadMore = React.useCallback(() => {
		if (pagination.status === "CanLoadMore") {
			pagination.loadMore(NOTE_CATALOG_PAGE_SIZE);
		}
	}, [pagination]);

	return {
		hasMore:
			pagination.status === "CanLoadMore" ||
			pagination.status === "LoadingMore",
		isLoadingMore: pagination.status === "LoadingMore",
		isLoadingFirstPage: pagination.status === "LoadingFirstPage",
		loadMore,
		notes:
			pagination.status === "LoadingFirstPage" ? undefined : pagination.results,
	};
}
