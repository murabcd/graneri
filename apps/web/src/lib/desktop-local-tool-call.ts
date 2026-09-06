import {
	type LocalCapabilitySession,
	parseLocalCapabilitySession,
} from "@workspace/ai/local-capability-session";
import {
	getLocalFileUploadCount,
	resolveLocalFileDownload,
	resolveLocalFileToolOutput,
} from "@workspace/ai/local-folder-file-contract";
import { isLocalFolderToolName } from "@workspace/ai/local-folder-tool-contract";
import type {
	ChatAddToolOutputFunction,
	ChatOnToolCallCallback,
	UIMessage,
} from "ai";
import type { RefObject } from "react";
import { z } from "zod";
import { logError } from "@/lib/logger";
import { getLocalFolderToolApiUrl } from "@/lib/runtime-config";
import type { Id } from "../../../../convex/_generated/dataModel";

export type LocalToolCall = {
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
	localCapabilitySession?: LocalCapabilitySession | null;
};

const localToolErrorResponseSchema = z.object({
	error: z.string().optional(),
});
const localToolSuccessResponseSchema = z.object({
	output: z
		.unknown()
		.refine(
			(output) => output !== undefined,
			"Local tool response is missing output.",
		),
});

export type LocalFileStorage = {
	generateUploadUrl: () => Promise<string>;
	getUrl: (storageId: Id<"_storage">) => Promise<string | null>;
	getOwnedUrl: (storageId: Id<"_storage">) => Promise<string | null>;
};

const getRequestLocalCapabilitySession = (
	requestBody: DesktopLocalToolRequestBody | null,
) => {
	if (!requestBody) {
		throw new Error(
			"Desktop local tool request is missing chat request context.",
		);
	}

	const session = parseLocalCapabilitySession(
		requestBody.localCapabilitySession,
	);
	if (!session) {
		throw new Error(
			"Desktop local tool request is missing its capability session.",
		);
	}

	return session;
};

const getErrorMessage = (error: unknown, fallback: string) =>
	error instanceof Error ? error.message : fallback;

export const executeDesktopLocalToolCall = async ({
	fetchImpl,
	fileStorage,
	localCapabilitySession,
	toolCall,
}: {
	fetchImpl: typeof fetch;
	fileStorage: LocalFileStorage;
	localCapabilitySession: LocalCapabilitySession;
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
	const [fileUploadUrls, fileDownload] = await Promise.all([
		Promise.all(
			Array.from({ length: fileUploadCount }, () =>
				fileStorage.generateUploadUrl(),
			),
		),
		resolveLocalFileDownload({
			input: toolCall.input,
			toolName: toolCall.toolName,
			resolveStorageUrl: fileStorage.getOwnedUrl,
		}),
	]);

	const response = await fetchImpl(apiUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			fileDownload,
			fileUploadUrls,
			sessionId: localCapabilitySession.id,
			toolCallId: toolCall.toolCallId,
			toolName: toolCall.toolName,
			input: toolCall.input,
		}),
	});
	if (!response.ok) {
		const errorPayload = localToolErrorResponseSchema.safeParse(
			await response.json().catch(() => null),
		);
		throw new Error(
			errorPayload.success && errorPayload.data.error
				? errorPayload.data.error
				: "Local tool execution failed.",
		);
	}

	const payload = localToolSuccessResponseSchema.parse(await response.json());
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
			localCapabilitySession: getRequestLocalCapabilitySession(requestBody),
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
		resolveRequestBody,
	}: {
		addToolOutputRef: RefObject<ChatAddToolOutputFunction<UIMessage> | null>;
		fetchImpl: typeof fetch;
		fileStorage: LocalFileStorage;
		resolveRequestBody: () => Promise<DesktopLocalToolRequestBody>;
	}): ChatOnToolCallCallback<UIMessage> =>
	async ({ toolCall }) => {
		if (toolCall.dynamic || !isLocalFolderToolName(toolCall.toolName)) return;
		const requestBody = await resolveRequestBody();
		await submitDesktopLocalToolCall({
			addToolOutputRef,
			fetchImpl,
			fileStorage,
			requestBody,
			requestOptions: { body: requestBody },
			toolCall: {
				input: toolCall.input,
				toolCallId: toolCall.toolCallId,
				toolName: toolCall.toolName,
			},
		});
	};
