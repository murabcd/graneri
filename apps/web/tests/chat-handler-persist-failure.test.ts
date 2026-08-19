import { createServer } from "node:http";
import {
	hostedChatReplayAcceptedHeader,
	hostedChatReplayQueuedMessageIdHeader,
	hostedChatSteerAcceptedHeader,
	hostedChatSteerQueuedMessageIdHeader,
	hostedChatSteerQueuedMessageIdsHeader,
	hostedChatSteerTurnIdHeader,
} from "@workspace/ai/hosted-chat-runtime";
import {
	type FunctionReference,
	getFunctionName,
	type OptionalRestArgs,
} from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultChatModel } from "@/lib/ai/models";
import {
	handleChatRequest,
	handleChatStopRequest,
} from "../server/chat-handler";
import type { JsonObject } from "../server/http-utils";

const convexMock = vi.hoisted(() => ({
	authorizeChatTurn: vi.fn(),
	contextState: vi.fn(),
	mutation: vi.fn(),
	query: vi.fn(),
}));

vi.mock("convex/browser", () => ({
	ConvexHttpClient: class {
		mutation = <Mutation extends FunctionReference<"mutation">>(
			functionReference: Mutation,
			...args: OptionalRestArgs<Mutation>
		) =>
			getFunctionName(functionReference) === "aiAccess:authorizeChatTurn"
				? convexMock.authorizeChatTurn(functionReference, args[0])
				: convexMock.mutation(functionReference, args[0]);
		query = <Query extends FunctionReference<"query">>(
			functionReference: Query,
			...args: OptionalRestArgs<Query>
		) =>
			getFunctionName(functionReference) ===
			"chatContextCompactions:getPreparationState"
				? convexMock.contextState(functionReference, args[0])
				: convexMock.query(functionReference, args[0]);
	},
}));

const previousConvexUrl = process.env.CONVEX_URL;
const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
const defaultChatModelId = defaultChatModel.model;

beforeEach(() => {
	process.env.CONVEX_URL = "https://example.convex.cloud";
	process.env.OPENAI_API_KEY = "test-key";
	convexMock.authorizeChatTurn.mockReset();
	convexMock.authorizeChatTurn.mockResolvedValue({
		admissionReservationId: "admission_1",
		tokenIdentifier: "https://graneri.test|owner",
	});
	convexMock.contextState.mockReset();
	convexMock.contextState.mockResolvedValue({
		compaction: null,
		hasMoreMessages: false,
		messages: [],
	});
	convexMock.query.mockReset();
	convexMock.mutation.mockReset();
});

afterEach(() => {
	if (previousConvexUrl === undefined) {
		delete process.env.CONVEX_URL;
	} else {
		process.env.CONVEX_URL = previousConvexUrl;
	}

	if (previousOpenAiApiKey === undefined) {
		delete process.env.OPENAI_API_KEY;
	} else {
		process.env.OPENAI_API_KEY = previousOpenAiApiKey;
	}
});

const postChatRequest = async (
	body: JsonObject,
	options: { includeHeaders?: boolean; isSteerRoute?: boolean } = {},
) => {
	const server = createServer((request, response) => {
		void handleChatRequest(request, response, {
			isSteerRoute: options.isSteerRoute,
		}).catch((error: unknown) => {
			response.statusCode = 500;
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		});
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});

	try {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Expected local HTTP server address.");
		}

		const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		const responseText = await response.text();
		const result = {
			status: response.status,
			body: responseText
				? (JSON.parse(responseText) as { error?: string })
				: null,
		};
		if (!options.includeHeaders) {
			return result;
		}

		return {
			...result,
			headers: response.headers,
		};
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}

				resolve();
			});
		});
	}
};

const postChatStopRequest = async (body: JsonObject) => {
	const server = createServer((request, response) => {
		void handleChatStopRequest(request, response).catch((error: unknown) => {
			response.statusCode = 500;
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		});
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});

	try {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Expected local HTTP server address.");
		}

		const response = await fetch(
			`http://127.0.0.1:${address.port}/api/chat/stop`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
		);

		return {
			status: response.status,
			body: (await response.json()) as { error?: string; ok?: boolean },
		};
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}

				resolve();
			});
		});
	}
};

describe("chat handler persistence failures", () => {
	it("returns structured queue errors when attachable run lookup fails closed", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockRejectedValueOnce({
			data: {
				code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
				message: "Chat has multiple active assistant runs.",
			},
		});

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: defaultChatModelId,
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 409,
			body: {
				error: "Chat has multiple active assistant runs.",
				errorCode: "ASSISTANT_RUN_INVARIANT_VIOLATION",
			},
		});
	});

	it("rate limits a model-producing turn before queue or stream mutations", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.authorizeChatTurn.mockRejectedValueOnce({
			data: {
				code: "AI_RATE_LIMITED",
				retryAfterMs: 2_500,
			},
		});

		const result = await postChatRequest(
			{
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: defaultChatModelId,
				appsEnabled: false,
				message: {
					id: "message_1",
					role: "user",
					parts: [{ type: "text", text: "hello" }],
				},
			},
			{ includeHeaders: true },
		);

		expect(result.status).toBe(429);
		expect(result.body).toEqual({
			error: "Too many chat requests. Please try again shortly.",
			errorCode: "rate_limited",
		});
		expect(result.headers.get("Retry-After")).toBe("3");
		expect(convexMock.mutation).not.toHaveBeenCalled();
	});

	it("returns structured queue errors when replay lookup fails validation", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.query.mockRejectedValueOnce({
			data: {
				code: "QUEUED_MESSAGE_INVALID_REQUEST_BODY",
				message: "Queued message request body is invalid.",
			},
		});

		await expect(
			postChatRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: defaultChatModelId,
				appsEnabled: false,
				replayQueuedMessageId: "queued_1",
			}),
		).resolves.toEqual({
			status: 400,
			body: {
				error: "Queued message request body is invalid.",
				errorCode: "QUEUED_MESSAGE_INVALID_REQUEST_BODY",
			},
		});
	});

	it("returns structured lifecycle errors when stop lookup fails closed", async () => {
		convexMock.query.mockRejectedValueOnce({
			data: {
				code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
				message: "Chat has multiple active assistant runs.",
			},
		});

		await expect(
			postChatStopRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
			}),
		).resolves.toEqual({
			status: 409,
			body: {
				error: "Chat has multiple active assistant runs.",
				errorCode: "ASSISTANT_RUN_INVARIANT_VIOLATION",
			},
		});
		expect(convexMock.authorizeChatTurn).not.toHaveBeenCalled();
	});

	it("rejects empty direct input before loading chat state", async () => {
		await expect(
			postChatRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: defaultChatModelId,
				appsEnabled: false,
				message: {
					id: "message_1",
					role: "user",
					parts: [{ type: "text", text: "   " }],
				},
			}),
		).resolves.toEqual({
			status: 400,
			body: { error: "input must not be empty" },
		});

		expect(convexMock.query).not.toHaveBeenCalled();
		expect(convexMock.mutation).not.toHaveBeenCalled();
	});

	it("fails closed instead of starting an assistant stream", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.mutation.mockRejectedValueOnce(new Error("save failed"));

		await expect(
			postChatRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: defaultChatModelId,
				appsEnabled: false,
				message: {
					id: "message_1",
					role: "user",
					parts: [{ type: "text", text: "hello" }],
				},
			}),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to persist user chat message." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(1);
	});

	it("starts a durable background run without a web active stream or web OpenAI key", async () => {
		delete process.env.OPENAI_API_KEY;
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.mutation.mockResolvedValueOnce({ ok: true });
		convexMock.mutation.mockResolvedValueOnce({
			_id: "run_1",
			assistantMessageId: "assistant_1",
			status: "running",
		});

		await expect(
			postChatRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: defaultChatModelId,
				appsEnabled: false,
				message: {
					id: "message_1",
					role: "user",
					parts: [{ type: "text", text: "hello" }],
				},
			}),
		).resolves.toEqual({
			status: 200,
			body: null,
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(2);
		expect(convexMock.mutation.mock.calls[1]?.[1]).toMatchObject({
			admissionReservationId: "admission_1",
			chatId: "chat_1",
			job: {
				model: defaultChatModelId,
				shouldGenerateChatTitle: false,
			},
			workspaceId: "workspace_1",
		});
	});

	it("keeps desktop-local tool turns on the web stream producer", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.mutation.mockResolvedValueOnce({ ok: true });
		convexMock.mutation.mockResolvedValueOnce({
			_id: "run_1",
			assistantMessageId: "assistant_1",
			status: "running",
		});
		convexMock.mutation.mockRejectedValueOnce(
			new Error("active stream failed"),
		);
		convexMock.mutation.mockResolvedValueOnce(null);

		await expect(
			postChatRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: defaultChatModelId,
				appsEnabled: false,
				localFolders: [
					{
						id: "folder_1",
						name: "Project",
						path: "/Users/test/Project",
					},
				],
				message: {
					id: "message_1",
					role: "user",
					parts: [{ type: "text", text: "Read the shared project" }],
				},
			}),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to start assistant stream." },
		});

		expect(
			convexMock.mutation.mock.calls.map(([reference]) =>
				getFunctionName(reference),
			),
		).toEqual([
			"chats:saveMessage",
			"assistantRuns:startAssistantRun",
			"chats:startActiveStream",
			"assistantRuns:failAssistantRun",
		]);
	});

	it("accepts and persists a completed desktop-local tool continuation", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.contextState.mockResolvedValueOnce({
			compaction: null,
			hasMoreMessages: false,
			messages: [
				{
					id: "user_1",
					role: "user",
					partsJson: JSON.stringify([
						{ type: "text", text: "Read the shared project" },
					]),
					createdAt: 1,
				},
				{
					id: "assistant_1",
					role: "assistant",
					partsJson: JSON.stringify([
						{
							type: "tool-list_local_directory",
							toolCallId: "call_1",
							input: { rootIndex: 0, relativePath: "." },
							state: "input-available",
						},
					]),
					createdAt: 2,
				},
			],
		});
		convexMock.mutation.mockResolvedValueOnce({ ok: true });
		convexMock.mutation.mockResolvedValueOnce({
			_id: "run_2",
			assistantMessageId: "assistant_2",
			status: "running",
		});
		convexMock.mutation.mockRejectedValueOnce(
			new Error("active stream failed"),
		);
		convexMock.mutation.mockResolvedValueOnce(null);

		await expect(
			postChatRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: defaultChatModelId,
				appsEnabled: false,
				localFolders: [
					{
						id: "folder_1",
						name: "Project",
						path: "/Users/test/Project",
					},
				],
				trigger: "submit-message",
				messageId: "assistant_1",
				message: {
					id: "assistant_1",
					role: "assistant",
					parts: [
						{
							type: "tool-list_local_directory",
							toolCallId: "call_1",
							input: { rootIndex: 0, relativePath: "." },
							output: { entries: [{ name: "meeting.txt" }] },
							state: "output-available",
						},
					],
				},
			}),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to start assistant stream." },
		});

		expect(
			convexMock.mutation.mock.calls.map(([reference]) =>
				getFunctionName(reference),
			),
		).toEqual([
			"chats:completeLocalFolderToolMessage",
			"assistantRuns:startAssistantRun",
			"chats:startActiveStream",
			"assistantRuns:failAssistantRun",
		]);
		expect(convexMock.mutation.mock.calls[0]?.[1]).toMatchObject({
			chatId: "chat_1",
			message: {
				id: "assistant_1",
				role: "assistant",
			},
			workspaceId: "workspace_1",
		});
		expect(convexMock.mutation.mock.calls[0]?.[1]).not.toHaveProperty("noteId");
	});

	it("fails closed when edited branch preservation fails", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.query.mockResolvedValueOnce([
			{
				id: "msg-1",
				role: "user",
				partsJson: JSON.stringify([{ type: "text", text: "Original" }]),
				createdAt: 1,
			},
			{
				id: "msg-2",
				role: "assistant",
				partsJson: JSON.stringify([{ type: "text", text: "Old answer" }]),
				createdAt: 2,
			},
		]);
		convexMock.mutation.mockRejectedValueOnce(new Error("branch failed"));

		await expect(
			postChatRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: defaultChatModelId,
				appsEnabled: false,
				trigger: "submit-message",
				messageId: "msg-2",
				message: {
					id: "edited-message",
					role: "user",
					parts: [{ type: "text", text: "Edited question" }],
				},
			}),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to prepare edited chat branch." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(1);
		expect(convexMock.mutation.mock.calls[0]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			messageId: "msg-2",
		});
		expect(convexMock.query).toHaveBeenCalledTimes(3);
	});

	it("prepares replayed queued messages from the claimed queue row before starting a run", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.query.mockResolvedValueOnce({
			_id: "queued_1",
			messageId: "message_1",
			text: "queued replay",
			metadataJson: undefined,
		});
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.mutation.mockResolvedValueOnce({ ok: true });
		convexMock.mutation.mockRejectedValueOnce(new Error("start failed"));

		const result = await postChatRequest(
			{
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: defaultChatModelId,
				appsEnabled: false,
				replayQueuedMessageId: "queued_1",
			},
			{ includeHeaders: true },
		);

		expect(result.status).toBe(500);
		expect(result.body).toEqual({
			error: "Failed to start hosted assistant run.",
		});
		expect(result.headers.get(hostedChatReplayAcceptedHeader)).toBe("true");
		expect(result.headers.get(hostedChatReplayQueuedMessageIdHeader)).toBe(
			"queued_1",
		);

		expect(convexMock.mutation.mock.calls[0]?.[1]).toMatchObject({
			queuedMessageId: "queued_1",
			message: {
				id: "message_1",
				role: "user",
				text: "queued replay",
			},
		});
		expect(convexMock.mutation.mock.calls[1]?.[1]).toMatchObject({
			chatId: "chat_1",
		});
	});

	it("rejects a replay request that also includes a client message body", async () => {
		await expect(
			postChatRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: defaultChatModelId,
				appsEnabled: false,
				replayQueuedMessageId: "queued_1",
				message: {
					id: "client_message_ignored",
					role: "user",
					parts: [{ type: "text", text: "tampered replay" }],
				},
			}),
		).resolves.toEqual({
			status: 400,
			body: {
				error:
					"Queued message replay and steering must not include a client message body.",
				errorCode: "queued_message_body_conflict",
			},
		});

		expect(convexMock.query).not.toHaveBeenCalled();
		expect(convexMock.mutation).not.toHaveBeenCalled();
	});

	it("discards a claimed steer message when active run interrupt fails", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				text: "queued steer",
				metadataJson: undefined,
			},
		]);
		convexMock.mutation.mockRejectedValueOnce(new Error("interrupt failed"));
		convexMock.mutation.mockResolvedValueOnce(null);

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: defaultChatModelId,
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to interrupt active assistant run." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(3);
		expect(convexMock.mutation.mock.calls[2]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			queuedMessageId: "queued_1",
		});
	});

	it("fails closed when claimed steer cleanup fails after active run interrupt failure", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				text: "queued steer",
				metadataJson: undefined,
			},
		]);
		convexMock.mutation.mockRejectedValueOnce(new Error("interrupt failed"));
		convexMock.mutation.mockRejectedValueOnce(new Error("discard failed"));

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: defaultChatModelId,
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to clean up claimed steered message." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(3);
		expect(convexMock.mutation.mock.calls[2]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			queuedMessageId: "queued_1",
		});
	});

	it("discards a claimed steer message when pre-accept preparation fails", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				text: "queued steer",
				metadataJson: undefined,
			},
		]);
		convexMock.mutation.mockResolvedValueOnce(null);
		convexMock.query.mockRejectedValueOnce(new Error("snapshot failed"));
		convexMock.mutation.mockResolvedValueOnce(null);

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: defaultChatModelId,
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to prepare steered assistant run." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(3);
		expect(convexMock.mutation.mock.calls[2]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			queuedMessageId: "queued_1",
		});
	});

	it("fails closed when claimed steer cleanup fails after preparation failure", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				text: "queued steer",
				metadataJson: undefined,
			},
		]);
		convexMock.mutation.mockResolvedValueOnce(null);
		convexMock.query.mockRejectedValueOnce(new Error("snapshot failed"));
		convexMock.mutation.mockRejectedValueOnce(new Error("discard failed"));

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: defaultChatModelId,
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to clean up claimed steered message." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(3);
		expect(convexMock.mutation.mock.calls[2]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			queuedMessageId: "queued_1",
		});
	});

	it("does not interrupt a waiting run before accepting queued input", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "waiting_for_user",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				text: "queued steer",
				metadataJson: undefined,
			},
		]);
		convexMock.query.mockRejectedValueOnce(new Error("snapshot failed"));
		convexMock.mutation.mockResolvedValueOnce(null);

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: defaultChatModelId,
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to prepare steered assistant run." },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(2);
		expect(convexMock.mutation.mock.calls[0]?.[1]).toEqual({
			runId: "run_1",
			queuedMessageId: "queued_1",
		});
		expect(convexMock.mutation.mock.calls[1]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			queuedMessageId: "queued_1",
		});
	});

	it("prepares steered input from the claimed queue row without a client message body", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				text: "queued steer",
				metadataJson: undefined,
			},
		]);
		convexMock.mutation.mockResolvedValueOnce(null);
		convexMock.query.mockRejectedValueOnce(new Error("snapshot failed"));
		convexMock.mutation.mockResolvedValueOnce(null);

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: defaultChatModelId,
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 500,
			body: { error: "Failed to prepare steered assistant run." },
		});

		expect(convexMock.mutation.mock.calls[0]?.[1]).toEqual({
			runId: "run_1",
			queuedMessageId: "queued_1",
		});
		expect(convexMock.mutation.mock.calls[2]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			queuedMessageId: "queued_1",
		});
	});

	it("accepts a steered input batch and lets the Convex producer continue it", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
			producer: "convex",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				text: "queued steer",
				metadataJson: undefined,
			},
			{
				_id: "queued_2",
				messageId: "message_2",
				text: "queued steer follow-up",
				metadataJson: undefined,
			},
		]);
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.mutation.mockResolvedValueOnce(null);

		const result = await postChatRequest(
			{
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
				model: defaultChatModelId,
				appsEnabled: false,
				continueRunId: "run_1",
				steerQueuedMessageId: "queued_1",
			},
			{ includeHeaders: true, isSteerRoute: true },
		);

		expect(result.status).toBe(200);
		expect(result.body).toBeNull();
		expect(result.headers.get(hostedChatSteerAcceptedHeader)).toBe("true");
		expect(result.headers.get(hostedChatSteerQueuedMessageIdHeader)).toBe(
			"queued_1",
		);
		expect(result.headers.get(hostedChatSteerQueuedMessageIdsHeader)).toBe(
			"queued_1,queued_2",
		);
		expect(result.headers.get(hostedChatSteerTurnIdHeader)).toBe("run_1");
		expect(convexMock.mutation).toHaveBeenCalledTimes(2);
		expect(convexMock.mutation.mock.calls[1]?.[1]).toMatchObject({
			admissionReservationId: "admission_1",
			runId: "run_1",
			messages: [
				expect.objectContaining({
					queuedMessageId: "queued_1",
					message: expect.objectContaining({
						id: "message_1",
						role: "user",
						text: "queued steer",
					}),
				}),
				expect.objectContaining({
					queuedMessageId: "queued_2",
					message: expect.objectContaining({
						id: "message_2",
						role: "user",
						text: "queued steer follow-up",
					}),
				}),
			],
		});
	});

	it("returns the stale steer transition error when cleanup sees an already consumed queue row", async () => {
		convexMock.query.mockResolvedValueOnce({
			model: defaultChatModelId,
			title: "Existing chat",
		});
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce([
			{
				_id: "queued_1",
				messageId: "message_1",
				text: "queued steer",
				metadataJson: undefined,
			},
		]);
		convexMock.mutation.mockResolvedValueOnce(null);
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce([]);
		convexMock.query.mockResolvedValueOnce(null);
		convexMock.mutation.mockRejectedValueOnce({
			data: {
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run cannot accept steered user input.",
			},
		});
		convexMock.mutation.mockRejectedValueOnce({
			data: {
				code: "QUEUED_MESSAGE_NOT_FOUND",
				message: "Queued message is no longer available.",
			},
		});

		await expect(
			postChatRequest(
				{
					id: "chat_1",
					workspaceId: "workspace_1",
					convexToken: "token_1",
					model: defaultChatModelId,
					appsEnabled: false,
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				{ isSteerRoute: true },
			),
		).resolves.toEqual({
			status: 409,
			body: {
				error: "Assistant run cannot accept steered user input.",
				errorCode: "INVALID_ASSISTANT_RUN_TRANSITION",
			},
		});

		expect(convexMock.mutation.mock.calls.at(-1)?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			queuedMessageId: "queued_1",
		});
	});

	it("terminalizes manual stops even when active stream cleanup fails", async () => {
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValueOnce(null);
		convexMock.mutation.mockRejectedValueOnce(
			new Error("active stream cleanup failed"),
		);
		convexMock.mutation.mockResolvedValueOnce(null);

		await expect(
			postChatStopRequest({
				id: "chat_1",
				workspaceId: "workspace_1",
				convexToken: "token_1",
			}),
		).resolves.toEqual({
			status: 500,
			body: { error: "active stream cleanup failed" },
		});

		expect(convexMock.mutation).toHaveBeenCalledTimes(3);
		expect(convexMock.mutation.mock.calls[0]?.[1]).toEqual({
			runId: "run_1",
			stopReason: "user_requested",
		});
		expect(convexMock.mutation.mock.calls[1]?.[1]).toEqual({
			workspaceId: "workspace_1",
			chatId: "chat_1",
			runId: "run_1",
		});
		expect(convexMock.mutation.mock.calls[2]?.[1]).toEqual({
			runId: "run_1",
		});
	});
});
