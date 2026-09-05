import { createServer } from "node:http";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import type { FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { QueuedChatRuntime } from "../src/app/queued-chat-runtime";

const state = vi.hoisted(() => ({
	origin: "",
	chats: ["chat-a", "chat-a"],
	head: null as FunctionReturnType<
		typeof api.assistantQueuedMessageDispatch.getHead
	>,
	token: vi.fn(),
	fetch: vi.fn<typeof fetch>(),
	convex: { query: vi.fn() },
	mutation: vi.fn(),
	loadMore: vi.fn(),
	status: "Exhausted",
}));
vi.mock("convex/react", () => ({
	useQuery: () => state.head,
	useConvex: () => state.convex,
	useMutation: () => state.mutation,
	usePaginatedQuery: () => ({
		results: state.chats,
		status: state.status,
		loadMore: state.loadMore,
	}),
}));
vi.mock("../src/lib/runtime-config", () => ({
	getChatApiUrl: () => `${state.origin}/chat`,
	getHostedApiUrl: () => `${state.origin}/steer`,
	getChatStreamApiUrl: () => `${state.origin}/stream`,
	getLocalFolderToolApiUrl: () => `${state.origin}/local`,
}));
vi.mock("../src/lib/convex-token", () => ({
	getCachedConvexToken: state.token,
}));
const workspaceId = "workspace" as Id<"workspaces">;
const head = (id: string): NonNullable<typeof state.head> => ({
	_id: id as Id<"assistantQueuedMessages">,
	_creationTime: 1,
	chatId: "chat" as Id<"chats">,
	createdAt: 1,
	updatedAt: 1,
	claimVersion: 0,
	ownerTokenIdentifier: "owner",
	workspaceId,
	runId: "run" as Id<"assistantRuns">,
	messageId: `queued-${id}`,
	text: id,
	status: "queued",
	requestBodyJson: JSON.stringify({
		...DEFAULT_CHAT_SETTINGS,
		projectId: null,
		localCapabilitySession: null,
		timezone: "UTC",
	}),
});
function App({ view }: { view: string }) {
	return (
		<>
			<QueuedChatRuntime workspaceId={workspaceId} />
			<div>{view}</div>
		</>
	);
}

let server: ReturnType<typeof createServer>;
beforeEach(async () => {
	state.head = null;
	state.chats = ["chat-a", "chat-a"];
	state.status = "Exhausted";
	state.token.mockReset().mockResolvedValue("token");
	state.fetch
		.mockReset()
		.mockImplementation(
			async () =>
				new Response(
					'data: {"type":"start","messageId":"assistant"}\n\ndata: {"type":"start-step"}\n\ndata: {"type":"text-start","id":"text"}\n\ndata: {"type":"text-delta","id":"text","delta":"Done"}\n\ndata: {"type":"text-end","id":"text"}\n\ndata: {"type":"finish-step"}\n\ndata: {"type":"finish","finishReason":"stop"}\n\ndata: [DONE]\n\n',
					{ headers: { "Content-Type": "text/event-stream" } },
				),
		);
	server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk);
		const result = await state.fetch(`${state.origin}${request.url}`, {
			method: request.method,
			body: Buffer.concat(chunks).toString(),
		});
		response.writeHead(result.status, Object.fromEntries(result.headers));
		response.end(await result.text());
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Expected TCP test server");
	state.origin = `http://127.0.0.1:${address.port}`;
	state.convex.query.mockReset();
	state.loadMore.mockReset();
});
afterEach(async () => {
	cleanup();
	vi.useRealTimers();
	server.closeAllConnections();
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
});

describe("app-owned queue execution", () => {
	it("dispatches after navigation and advances from durable eligibility without waiting for old headers", async () => {
		const view = render(<App view="chat-a" />);
		expect(state.fetch).not.toHaveBeenCalled();
		state.head = head("one");
		view.rerender(<App view="note" />);
		await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
		expect(
			JSON.parse(String(state.fetch.mock.calls[0][1]?.body)),
		).toMatchObject({
			replayQueuedMessageId: "one",
		});
		state.head = null;
		view.rerender(<App view="settings" />);
		state.head = head("two");
		view.rerender(<App view="settings" />);
		await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
	});
	it("rechecks eligibility after asynchronous token preparation", async () => {
		let resolveToken: (token: string) => void = () => {};
		state.token.mockReturnValue(
			new Promise<string>((resolve) => {
				resolveToken = resolve;
			}),
		);
		state.head = head("one");
		const view = render(<App view="chat-a" />);
		state.head = null;
		view.rerender(<App view="note" />);
		await act(async () => resolveToken("token"));
		expect(state.fetch).not.toHaveBeenCalled();
	});
	it("backs off transient authentication failures and cancels retries when work disappears", async () => {
		vi.useFakeTimers();
		state.token.mockResolvedValue(null);
		state.head = head("one");
		const view = render(<App view="note" />);
		await act(async () => {});
		expect(state.token).toHaveBeenCalledOnce();
		await act(async () => vi.advanceTimersByTimeAsync(1000));
		expect(state.token).toHaveBeenCalledTimes(2);
		state.chats = [];
		view.rerender(<App view="note" />);
		await act(async () => vi.advanceTimersByTimeAsync(30_000));
		expect(state.token).toHaveBeenCalledTimes(2);
		expect(state.fetch).not.toHaveBeenCalled();
	});
	it("loads every discovery page and mounts only one worker per chat", async () => {
		state.status = "CanLoadMore";
		state.head = head("one");
		render(<App view="note" />);
		await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
		expect(state.loadMore).toHaveBeenCalledWith(50);
	});
	it("finishes local tools and sends a fenced continuation after the initiating view unmounts", async () => {
		const capability = { id: "capability", label: "Folder" };
		state.head = {
			...head("local"),
			requestBodyJson: JSON.stringify({
				...DEFAULT_CHAT_SETTINGS,
				projectId: null,
				localCapabilitySession: capability,
				timezone: "UTC",
			}),
		};
		state.convex.query.mockResolvedValue({
			_id: "successor",
			status: "running",
			assistantMessageId: "assistant",
			localCapabilitySession: capability,
		});
		let release: (response: Response) => void = () => {};
		state.fetch.mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					release = resolve;
				}),
		);
		state.fetch.mockImplementationOnce(
			async () =>
				new Response(JSON.stringify({ output: { entries: [] } }), {
					headers: { "Content-Type": "application/json" },
				}),
		);
		const view = render(<App view="chat-a" />);
		await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
		view.unmount();
		const chunks = [
			{ type: "start", messageId: "assistant" },
			{ type: "start-step" },
			{
				type: "tool-input-available",
				toolCallId: "local-call",
				toolName: "list_local_directory",
				input: { rootIndex: 0, relativePath: "." },
			},
			{ type: "finish-step" },
			{ type: "finish", finishReason: "tool-calls" },
		];
		release(
			new Response(
				chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
					"data: [DONE]\n\n",
				{ headers: { "Content-Type": "text/event-stream" } },
			),
		);
		await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(3));
		const continuation = JSON.parse(String(state.fetch.mock.calls[2][1]?.body));
		expect(continuation.continueRunId).toBe("successor");
		expect(continuation).not.toHaveProperty("replayQueuedMessageId");
		expect(continuation).not.toHaveProperty("steerQueuedMessageId");
		expect(continuation.message).toMatchObject({
			id: "assistant",
			role: "assistant",
		});
	});
});
