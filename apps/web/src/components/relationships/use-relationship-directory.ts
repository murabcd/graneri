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
	const complete =
		primary.status === "Exhausted" ||
		(kind === "people" &&
			primary.results.length > RELATIONSHIP_DIRECTORY_RESULT_LIMIT);

	React.useEffect(() => {
		if (!complete && primary.status === "CanLoadMore") {
			primary.loadMore(RELATIONSHIP_DIRECTORY_PAGE_SIZE);
		}
	}, [complete, primary.status, primary.loadMore]);

	const result = React.useMemo(
		() =>
			workspaceId && complete
				? selectDirectoryEntries(primary.results, kind)
				: undefined,
		[workspaceId, complete, kind, primary.results],
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
