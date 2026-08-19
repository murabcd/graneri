import type { ToolSet } from "ai";
import type { LocalCommandExecutionResult } from "./local-folder-tool-contract.mjs";

export type LocalFolderRoot = {
	name: string;
	path: string;
	source?: string;
};

export declare const buildLocalFolderSystemContext: (
	roots: LocalFolderRoot[],
) => string;

export type ExecuteLocalCommand = (input: {
	command: string;
	rootPath: string;
}) => Promise<LocalCommandExecutionResult>;

export type StoreLocalImage = (input: {
	bytes: Uint8Array;
	mediaType: string;
}) => Promise<{ storageId: string }>;

export declare const buildLocalFolderTools: (input: {
	executeLocalCommand: ExecuteLocalCommand;
	roots: LocalFolderRoot[];
	storeLocalImage: StoreLocalImage;
}) => ToolSet;

export declare const buildClientLocalFolderTools: (
	roots: LocalFolderRoot[],
) => ToolSet;
