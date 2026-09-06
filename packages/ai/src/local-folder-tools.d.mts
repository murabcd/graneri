import type { ToolSet } from "ai";
import type { LocalCommandExecutionResult } from "./local-folder-tool-contract.mjs";

export type LocalFolderRoot = {
	name: string;
	path: string;
	source?: string;
};

export type LocalFolderDescriptor = {
	id: string;
	name: string;
};

export declare const buildLocalFolderSystemContext: (
	roots: Array<Pick<LocalFolderRoot, "name">>,
) => string;

export type ExecuteLocalCommand = (input: {
	command: string;
	rootPath: string;
}) => Promise<LocalCommandExecutionResult>;

export type StoreLocalFile = (input: {
	bytes: Uint8Array;
	mediaType: string;
}) => Promise<{ storageId: string }>;

export declare const buildLocalFolderTools: (input: {
	downloadLocalFile: (storageId: string) => Promise<Uint8Array>;
	executeLocalCommand: ExecuteLocalCommand;
	roots: LocalFolderRoot[];
	storeLocalFile: StoreLocalFile;
}) => ToolSet;

export declare const buildClientLocalFolderTools: (
	roots: LocalFolderDescriptor[],
) => ToolSet;
