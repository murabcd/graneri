import { usePaginatedQuery } from "convex/react";
import * as React from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
	type DirectoryKind,
	RELATIONSHIP_DIRECTORY_PAGE_SIZE,
	RELATIONSHIP_DIRECTORY_RESULT_LIMIT,
	selectDirectoryEntries,
} from "../../../../../convex/relationshipDirectoryModel";

export function useRelationshipDirectory(
	kind: DirectoryKind,
	workspaceId: Id<"workspaces"> | null,
	searchQuery: string,
) {
	const query = React.useDeferredValue(searchQuery);
	const args = workspaceId ? { workspaceId, query } : "skip";
	const primary = usePaginatedQuery(
		kind === "people"
			? api.relationshipDirectory.listPeople
			: api.relationshipDirectory.listCompanies,
		args,
		{ initialNumItems: RELATIONSHIP_DIRECTORY_PAGE_SIZE },
	);
	const derived = usePaginatedQuery(
		api.relationshipDirectory.listCompaniesFromPeople,
		kind === "companies" ? args : "skip",
		{ initialNumItems: RELATIONSHIP_DIRECTORY_PAGE_SIZE },
	);
	const primaryComplete =
		primary.status === "Exhausted" ||
		(kind === "people" &&
			primary.results.length > RELATIONSHIP_DIRECTORY_RESULT_LIMIT);
	const complete =
		primaryComplete && (kind === "people" || derived.status === "Exhausted");

	React.useEffect(() => {
		if (!primaryComplete && primary.status === "CanLoadMore") {
			primary.loadMore(RELATIONSHIP_DIRECTORY_PAGE_SIZE);
		}
	}, [primaryComplete, primary.status, primary.loadMore]);
	React.useEffect(() => {
		if (kind === "companies" && derived.status === "CanLoadMore") {
			derived.loadMore(RELATIONSHIP_DIRECTORY_PAGE_SIZE);
		}
	}, [kind, derived.status, derived.loadMore]);

	const result = React.useMemo(
		() =>
			workspaceId && complete
				? selectDirectoryEntries(
						kind === "people"
							? primary.results
							: [...primary.results, ...derived.results],
						kind,
					)
				: undefined,
		[workspaceId, complete, kind, primary.results, derived.results],
	);
	const snapshotRef = React.useRef<{
		result: ReturnType<typeof selectDirectoryEntries>;
		workspaceId: Id<"workspaces">;
		kind: typeof kind;
	} | null>(null);
	React.useLayoutEffect(() => {
		if (workspaceId && result !== undefined) {
			snapshotRef.current = { result, workspaceId, kind };
		}
	}, [result, workspaceId, kind]);

	return result !== undefined
		? result
		: snapshotRef.current?.workspaceId === workspaceId &&
				snapshotRef.current.kind === kind
			? snapshotRef.current.result
			: undefined;
}
