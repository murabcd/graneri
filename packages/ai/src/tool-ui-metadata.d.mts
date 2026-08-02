export type ToolUiIcon =
	| "calendar"
	| "chart"
	| "database"
	| "file-image"
	| "file-search"
	| "file-text"
	| "folder"
	| "folder-open"
	| "globe"
	| "search"
	| "terminal";

export type ToolUiMetadata = {
	complete: string;
	error?: string;
	groupKey?: string;
	icon: ToolUiIcon;
	running: string;
	subtitleKeys?: string[];
};

export declare const toolUiMetadata: Record<string, ToolUiMetadata>;

export declare function getToolUiMetadata(
	toolName: string,
): ToolUiMetadata | null;
