import type { UIMessage } from "ai";

type LocalFolderToolMessage = {
	id: string;
	role: string;
	parts: unknown[];
};

export declare const LOCAL_FOLDER_TOOL_NAMES: readonly string[];

export declare const isLocalFolderToolName: (toolName: string) => boolean;

export type LocalCommandExecutionResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
	truncated: boolean;
};

export declare const parseLocalCommandExecutionResult: (
	value: unknown,
) => LocalCommandExecutionResult;

export declare const isLocalFolderToolContinuationMessage: (
	message: LocalFolderToolMessage | null | undefined,
) => boolean;

export declare const createCanonicalLocalFolderToolContinuation: (args: {
	message: LocalFolderToolMessage;
	storedMessage:
		| {
				id: string;
				role: "user" | "assistant";
				partsJson: string;
				metadataJson?: string;
		  }
		| null
		| undefined;
}) => UIMessage;
