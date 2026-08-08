import type { ToolSet } from "ai";
import type {
	GraneriCapabilityAdapters,
	WorkspaceToolConnection,
} from "./capability-registry.mjs";

export type WorkspaceToolScope = "available" | "disabled" | "selected";

export type WorkspaceToolConnectionSource = {
	label: string;
	load(): Promise<WorkspaceToolConnection[]>;
};

export declare function loadWorkspaceToolConnections(
	sources: WorkspaceToolConnectionSource[],
): Promise<WorkspaceToolConnection[]>;

export declare function buildWorkspaceToolCatalog(args: {
	adapters?: GraneriCapabilityAdapters;
	connections: WorkspaceToolConnection[];
	meetingTools?: ToolSet;
	scope: WorkspaceToolScope;
	selectedSourceIds?: string[];
}): Promise<{
	availableConnections: WorkspaceToolConnection[];
	selectedConnections: WorkspaceToolConnection[];
	selectedSourceInstructions: string;
	tools: ToolSet;
}>;
