import {
	getLocalFileUploadCount,
	resolveLocalFileToolOutput,
} from "@workspace/ai/local-folder-file-contract";
import { isLocalFolderToolName } from "@workspace/ai/local-folder-tool-contract";
import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import type {
	ChatAddToolOutputFunction,
	ChatOnToolCallCallback,
	UIMessage,
} from "ai";
import type { RefObject } from "react";
import { logError } from "@/lib/logger";
import { getLocalFolderToolApiUrl } from "@/lib/runtime-config";
import type { Id } from "../../../../convex/_generated/dataModel";

type LocalToolCall = {
	toolCallId: string;
	toolName: string;
	input: unknown;
};

type LocalToolRequestOptions =
	| {
			body: DesktopLocalToolRequestBody;
	  }
	| undefined;

type DesktopLocalToolRequestBody = {
	localFolders?: DesktopLocalFolder[];
};

export type LocalFileStorage = {
	generateUploadUrl: () => Promise<string>;
	getUrl: (storageId: Id<"_storage">) => Promise<string | null>;
};

export const isDesktopLocalFolderArray = (
	value: unknown,
): value is DesktopLocalFolder[] =>
	Array.isArray(value) &&
	value.every(
		(folder) =>
			typeof folder?.id === "string" &&
			typeof folder.name === "string" &&
			typeof folder.path === "string",
	);

const getRequestLocalFolders = (
	requestBody: DesktopLocalToolRequestBody | null,
) => {
	if (!requestBody) {
		throw new Error(
			"Desktop local tool request is missing chat request context.",
		);
	}

	if (!isDesktopLocalFolderArray(requestBody.localFolders)) {
		throw new Error(
			"Desktop local tool request is missing shared local folders.",
		);
	}

	return requestBody.localFolders;
};

const getErrorMessage = (error: unknown, fallback: string) =>
	error instanceof Error ? error.message : fallback;

const executeDesktopLocalToolCall = async ({
	fetchImpl,
	fileStorage,
	localFolders,
	toolCall,
}: {
	fetchImpl: typeof fetch;
	fileStorage: LocalFileStorage;
	localFolders: DesktopLocalFolder[];
	toolCall: LocalToolCall;
}) => {
	const apiUrl = getLocalFolderToolApiUrl();

	if (!apiUrl) {
		throw new Error("Desktop local tools are unavailable in this runtime.");
	}

	if (!isLocalFolderToolName(toolCall.toolName)) {
		throw new Error(`Unsupported local tool: ${toolCall.toolName}.`);
	}
	const fileUploadCount = getLocalFileUploadCount({
		input: toolCall.input,
		toolName: toolCall.toolName,
	});
	const fileUploadUrls = await Promise.all(
		Array.from({ length: fileUploadCount }, () =>
			fileStorage.generateUploadUrl(),
		),
	);

	const response = await fetchImpl(apiUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			fileUploadUrls,
			localFolders,
			toolCallId: toolCall.toolCallId,
			toolName: toolCall.toolName,
			input: toolCall.input,
		}),
	});
	if (!response.ok) {
		const errorPayload = (await response.json().catch(() => ({}))) as {
			error?: string;
		};
		throw new Error(errorPayload.error || "Local tool execution failed.");
	}

	const payload = (await response.json().catch(() => ({}))) as {
		output?: unknown;
	};
	return await resolveLocalFileToolOutput({
		output: payload.output,
		resolveStorageUrl: fileStorage.getUrl,
		toolName: toolCall.toolName,
	});
};

const submitDesktopLocalToolCall = async ({
	addToolOutputRef,
	fetchImpl,
	fileStorage,
	requestBody,
	requestOptions,
	toolCall,
}: {
	addToolOutputRef: RefObject<ChatAddToolOutputFunction<UIMessage> | null>;
	fetchImpl: typeof fetch;
	fileStorage: LocalFileStorage;
	requestBody: DesktopLocalToolRequestBody | null;
	requestOptions: LocalToolRequestOptions;
	toolCall: LocalToolCall;
}) => {
	try {
		const output = await executeDesktopLocalToolCall({
			fetchImpl,
			fileStorage,
			localFolders: getRequestLocalFolders(requestBody),
			toolCall,
		});
		addToolOutputRef.current?.({
			options: requestOptions,
			output,
			tool: toolCall.toolName,
			toolCallId: toolCall.toolCallId,
		});
	} catch (toolError) {
		const errorText = getErrorMessage(
			toolError,
			"Local tool execution failed.",
		);
		logError({
			event: "client.error",
			error: {
				error: errorText,
				toolCallId: toolCall.toolCallId,
				toolName: toolCall.toolName,
			},
			message: "[desktop-local-tool] failed",
		});
		addToolOutputRef.current?.({
			errorText,
			options: requestOptions,
			state: "output-error",
			tool: toolCall.toolName,
			toolCallId: toolCall.toolCallId,
		});
	}
};

export const createDesktopLocalToolCallHandler =
	({
		addToolOutputRef,
		fetchImpl,
		fileStorage,
		latestRequestBodyRef,
	}: {
		addToolOutputRef: RefObject<ChatAddToolOutputFunction<UIMessage> | null>;
		fetchImpl: typeof fetch;
		fileStorage: LocalFileStorage;
		latestRequestBodyRef: RefObject<DesktopLocalToolRequestBody | null>;
	}): ChatOnToolCallCallback<UIMessage> =>
	({ toolCall }) => {
		if (toolCall.dynamic) {
			return;
		}

		const toolName = toolCall.toolName;
		if (!isLocalFolderToolName(toolName)) {
			return;
		}

		const requestBody = latestRequestBodyRef.current;
		const requestOptions = requestBody ? { body: requestBody } : undefined;
		void submitDesktopLocalToolCall({
			addToolOutputRef,
			fetchImpl,
			fileStorage,
			requestBody,
			requestOptions,
			toolCall: {
				input: toolCall.input,
				toolCallId: toolCall.toolCallId,
				toolName,
			},
		});
	};
