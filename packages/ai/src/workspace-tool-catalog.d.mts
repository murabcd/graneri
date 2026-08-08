import type { ToolSet } from "ai";
import type { AppSourceInstructionConnection } from "./capability-metadata.mjs";
import type {
	GraneriCapabilityAdapters,
	WorkspaceToolConnection,
} from "./capability-registry.mjs";

export type WorkspaceToolScope = "available" | "disabled" | "selected";

export type WorkspaceToolConnectionSource = {
	label: string;
	load(): Promise<WorkspaceToolConnection[]>;
};

export declare function getWorkspaceToolConnectionId(
	connection: AppSourceInstructionConnection,
): string;

export declare function getWorkspaceToolConnectionDisplayName(
	connection: AppSourceInstructionConnection,
): string;

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
