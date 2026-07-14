import { createServer } from "node:http";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleChatReconnectRequest } from "../server/chat-handler";

const convexMock = vi.hoisted(() => ({
	mutation: vi.fn(),
	query: vi.fn(),
}));

vi.mock("convex/browser", () => ({
	ConvexHttpClient: class {
		mutation = (
			functionReference: FunctionReference<"mutation">,
			args: Record<string, unknown>,
		) => convexMock.mutation(getFunctionName(functionReference), args);
		query = convexMock.query;
	},
}));

const previousConvexUrl = process.env.CONVEX_URL;

beforeEach(() => {
	process.env.CONVEX_URL = "https://example.convex.cloud";
	convexMock.query.mockReset();
	convexMock.mutation.mockReset();
});

afterEach(() => {
	if (previousConvexUrl === undefined) {
		delete process.env.CONVEX_URL;
	} else {
		process.env.CONVEX_URL = previousConvexUrl;
	}
});

const getChatReconnectRequest = async () => {
	const server = createServer((request, response) => {
		void handleChatReconnectRequest(request, response).catch(
			(error: unknown) => {
				response.statusCode = 500;
				response.setHeader("Content-Type", "application/json");
				response.end(
					JSON.stringify({
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			},
		);
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
			`http://127.0.0.1:${address.port}/api/chat/chat_1/stream?workspaceId=workspace_1`,
			{ headers: { Authorization: "Bearer token_1" } },
		);
		return { status: response.status, body: await response.text() };
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
};

describe("chat reconnect handler", () => {
	it("returns structured lifecycle errors when run lookup fails closed", async () => {
		convexMock.query.mockRejectedValueOnce({
			data: {
				code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
				message: "Chat has multiple active assistant runs.",
			},
		});

		await expect(getChatReconnectRequest()).resolves.toEqual({
			status: 409,
			body: JSON.stringify({
				error: "Chat has multiple active assistant runs.",
				errorCode: "ASSISTANT_RUN_INVARIANT_VIOLATION",
			}),
		});
		expect(convexMock.mutation).not.toHaveBeenCalled();
	});

	it("interrupts orphaned running runs with no live stream session", async () => {
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			assistantMessageId: "assistant_1",
		});
		convexMock.mutation.mockResolvedValue(null);

		await expect(getChatReconnectRequest()).resolves.toEqual({
			status: 204,
			body: "",
		});

		expect(convexMock.mutation.mock.calls.map(([name]) => name)).toEqual([
			"assistantRuns:requestStopAssistantRun",
			"chats:stopActiveStream",
			"assistantRuns:finishStoppedAssistantRun",
		]);
	});

	it("preserves runs waiting for user input when no stream exists", async () => {
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "waiting_for_user",
			assistantMessageId: "assistant_1",
			pendingDecision: {
				type: "tool_approval",
				approvalId: "approval_1",
				assistantMessageId: "assistant_1",
				toolCallId: "call_1",
				toolName: "delete_automation",
			},
		});

		await expect(getChatReconnectRequest()).resolves.toEqual({
			status: 204,
			body: "",
		});
		expect(convexMock.mutation).not.toHaveBeenCalled();
	});

	it("preserves Convex-owned running producers when no web stream exists", async () => {
		convexMock.query.mockResolvedValueOnce({
			_id: "run_1",
			status: "running",
			producer: "convex",
			assistantMessageId: "assistant_1",
		});

		await expect(getChatReconnectRequest()).resolves.toEqual({
			status: 204,
			body: "",
		});
		expect(convexMock.mutation).not.toHaveBeenCalled();
	});
});
