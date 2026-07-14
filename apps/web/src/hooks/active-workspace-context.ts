import * as React from "react";
import { use } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";

export const ActiveWorkspaceContext =
	React.createContext<Id<"workspaces"> | null>(null);

export function useActiveWorkspaceId() {
	return use(ActiveWorkspaceContext);
}
