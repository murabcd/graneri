import type { ToolSet } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../../convex/_generated/dataModel";
import type { WorkspaceToolConnection } from "./capability-registry.mjs";
import type { WorkspaceToolScope } from "./workspace-tool-catalog.mjs";

export declare function buildConvexWorkspaceToolSet(args: {
	connections: WorkspaceToolConnection[];
	convexClient: ConvexHttpClient | null;
	scope?: WorkspaceToolScope;
	selectedSourceIds?: string[];
	workspaceId: Id<"workspaces"> | null;
}): Promise<{
	availableConnections: WorkspaceToolConnection[];
	selectedConnections: WorkspaceToolConnection[];
	selectedSourceInstructions: string;
	tools: ToolSet;
}>;
