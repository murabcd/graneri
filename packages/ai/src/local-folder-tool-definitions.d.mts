import type { ToolResultOutput } from "@ai-sdk/provider-utils";
import type { z } from "zod";

type ToModelOutput = (args: {
	input: unknown;
	output: unknown;
	toolCallId: string;
}) => ToolResultOutput | PromiseLike<ToolResultOutput>;

export type LocalFolderToolRoot = {
	name: string;
	path: string;
	source?: string;
};

export declare const MAX_LOCAL_FOLDER_ROOTS: number;
export declare const MAX_LOCAL_FILE_READ_BYTES: number;
export declare const MAX_LOCAL_COMMAND_LENGTH: number;
export declare const assertLocalFolderRootLimit: (roots: {
	readonly length: number;
}) => void;

export declare const LOCAL_FOLDER_TOOL_NAMES: readonly string[];
export declare const LOCAL_FOLDER_TOOL_UI_METADATA: Readonly<
	Record<
		string,
		{
			complete: string;
			groupKey: string;
			icon: string;
			running: string;
			subtitleKeys?: string[];
		}
	>
>;

export declare const buildLocalFolderSystemContext: (
	roots: LocalFolderToolRoot[],
) => string;

type LocalFolderToolConfig = {
	description: string;
	inputSchema: z.ZodType;
	strict?: boolean;
	providerOptions?: unknown;
	toModelOutput?: ToModelOutput;
};

export declare const buildLocalFolderToolConfigs: (
	roots: LocalFolderToolRoot[],
	options?: {
		maxImageSearchResults?: number;
		providerOptions?: unknown;
	},
) => Record<string, LocalFolderToolConfig>;
