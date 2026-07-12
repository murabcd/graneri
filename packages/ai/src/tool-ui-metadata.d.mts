export type ToolUiMetadata = {
	complete: string;
	groupKey?: string;
	icon: string;
	running: string;
	subtitleKeys?: string[];
};

export declare const toolUiMetadata: Record<string, ToolUiMetadata>;

export declare function getToolUiMetadata(
	toolName: string,
): ToolUiMetadata | null;
