import type { z } from "zod";

export type LocalFolderToolRoot = {
	name: string;
	path: string;
	source?: string;
};

export declare const MAX_LOCAL_FOLDER_ROOTS: number;
export declare const MAX_LOCAL_FILE_READ_BYTES: number;
export declare const MAX_LOCAL_COMMAND_LENGTH: number;

export declare const buildLocalFolderSystemContext: (
	roots: LocalFolderToolRoot[],
) => string;

export declare const buildLocalFolderToolConfigs: (
	roots: LocalFolderToolRoot[],
	options?: {
		maxImageSearchResults?: number;
		providerOptions?: unknown;
	},
) => {
	list_local_directory: {
		description: string;
		inputSchema: z.ZodType;
	};
	read_local_file: {
		description: string;
		inputSchema: z.ZodType;
	};
	inspect_local_image: {
		description: string;
		inputSchema: z.ZodType;
	};
	search_local_images: {
		description: string;
		inputSchema: z.ZodType;
	};
	search_local_files: {
		description: string;
		inputSchema: z.ZodType;
	};
	run_local_command: {
		description: string;
		inputSchema: z.ZodType;
	};
	get_shared_local_folders: {
		description: string;
		inputSchema: z.ZodType;
	};
};
