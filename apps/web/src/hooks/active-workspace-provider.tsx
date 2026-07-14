import type * as React from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ActiveWorkspaceContext } from "./active-workspace-context";

export function ActiveWorkspaceProvider({
	workspaceId,
	children,
}: {
	workspaceId: Id<"workspaces"> | null;
	children: React.ReactNode;
}) {
	return (
		<ActiveWorkspaceContext.Provider value={workspaceId}>
			{children}
		</ActiveWorkspaceContext.Provider>
	);
}
