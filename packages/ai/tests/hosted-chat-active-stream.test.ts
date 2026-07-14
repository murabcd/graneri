import { describe, expect, it, vi } from "vitest";
import {
	createHostedActiveChatStreamSession,
	createHostedActiveStreamKey,
	createHostedActiveStreamSession,
	HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS,
	HostedActiveChatStreamPersister,
	pipeHostedActiveStreamText,
} from "../src/hosted-chat-active-stream.mjs";
import type { HostedTurnInputBuffer } from "../src/hosted-chat-turn-input-buffer.mjs";
import { createHostedTurnInputBuffer } from "../src/hosted-chat-turn-input-buffer.mjs";

const collectStream = async <T>(stream: ReadableStream<T>) => {
	const reader = stream.getReader();
	const chunks: T[] = [];

	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			return chunks;
		}
		chunks.push(value);
	}
};

const createTestActiveStreamSession = (
	args: Omit<
		Parameters<typeof createHostedActiveStreamSession>[0],
		"turnInput"
	> & { turnInput?: HostedTurnInputBuffer },
) =>
	createHostedActiveStreamSession({
		...args,
		turnInput: args.turnInput ?? createHostedTurnInputBuffer(),
	});

describe("hosted active chat stream", () => {
	it("creates stable stream keys for active stream controllers", () => {
		expect(
			createHostedActiveStreamKey({
				workspaceId: "workspace-1",
				chatId: "chat-1",
			}),
		).toBe("workspace-1:chat-1");
	});

	it("batches active stream deltas and finishes through adapter callbacks", async () => {
		const startActiveStream = vi.fn().mockResolvedValue(undefined);
		const appendActiveStreamText = vi.fn().mockResolvedValue(undefined);
		const finishActiveStream = vi.fn().mockResolvedValue(undefined);
		const startActiveStreamToolCall = vi.fn().mockResolvedValue(undefined);
		const finishActiveStreamToolCall = vi.fn().mockResolvedValue(undefined);
		const persister = new HostedActiveChatStreamPersister({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			messageId: "stream-1",
			runId: "run-1",
			startActiveStream,
			appendActiveStreamText,
			finishActiveStream,
			startActiveStreamToolCall,
			finishActiveStreamToolCall,
		});

		await persister.start();
		persister.append("hello");
		persister.append(" world");
		await persister.startToolCall({
			toolCallId: "tool-call-1",
			toolName: "search",
			input: { query: "graneri" },
		});
		await persister.finishToolCall({
			toolCallId: "tool-call-1",
			status: "completed",
			output: { result: "ok" },
		});
		await persister.flush();
		await persister.finish();

		expect(startActiveStream).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
		});
		expect(appendActiveStreamText).toHaveBeenCalledTimes(1);
		expect(appendActiveStreamText).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
			delta: "hello world",
		});
		expect(finishActiveStream).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
		});
		expect(startActiveStreamToolCall).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
			toolCallId: "tool-call-1",
			toolName: "search",
			inputJson: JSON.stringify({ query: "graneri" }),
		});
		expect(finishActiveStreamToolCall).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
			toolCallId: "tool-call-1",
			status: "completed",
			outputJson: JSON.stringify({ result: "ok" }),
			errorText: undefined,
		});
	});

	it("surfaces scheduled active stream append failures through finish", async () => {
		vi.useFakeTimers();
		try {
			const startActiveStream = vi.fn().mockResolvedValue(undefined);
			const appendActiveStreamText = vi
				.fn()
				.mockRejectedValue(new Error("append failed"));
			const finishActiveStream = vi.fn().mockResolvedValue(undefined);
			const persister = new HostedActiveChatStreamPersister({
				workspaceId: "workspace-1",
				chatId: "chat-1",
				messageId: "stream-1",
				runId: "run-1",
				startActiveStream,
				appendActiveStreamText,
				finishActiveStream,
			});

			persister.append("hello");
			vi.advanceTimersByTime(HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS);
			await Promise.resolve();
			await Promise.resolve();

			await expect(persister.finish()).rejects.toThrow("append failed");
			expect(finishActiveStream).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("drops pending active stream text after cleanup closes persistence", async () => {
		vi.useFakeTimers();
		try {
			const startActiveStream = vi.fn().mockResolvedValue(undefined);
			const appendActiveStreamText = vi.fn().mockResolvedValue(undefined);
			const finishActiveStream = vi.fn().mockResolvedValue(undefined);
			const persister = new HostedActiveChatStreamPersister({
				workspaceId: "workspace-1",
				chatId: "chat-1",
				messageId: "stream-1",
				runId: "run-1",
				startActiveStream,
				appendActiveStreamText,
				finishActiveStream,
			});

			persister.append("hello");
			persister.discardPending();
			vi.advanceTimersByTime(HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS);
			await persister.flush();
			await persister.finish();

			expect(appendActiveStreamText).not.toHaveBeenCalled();
			expect(finishActiveStream).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("drops buffered active stream text captured behind an in-flight flush after discard", async () => {
		let resolveFirstFlush: (() => void) | null = null;
		const firstFlush = new Promise<void>((resolve) => {
			resolveFirstFlush = resolve;
		});
		const startActiveStream = vi.fn().mockResolvedValue(undefined);
		const appendActiveStreamText = vi
			.fn()
			.mockReturnValueOnce(firstFlush)
			.mockResolvedValue(undefined);
		const finishActiveStream = vi.fn().mockResolvedValue(undefined);
		const persister = new HostedActiveChatStreamPersister({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			messageId: "stream-1",
			runId: "run-1",
			startActiveStream,
			appendActiveStreamText,
			finishActiveStream,
		});

		persister.append("first");
		const firstFlushPromise = persister.flush();
		await Promise.resolve();
		persister.append("second");
		const secondFlushPromise = persister.flush();
		await Promise.resolve();

		persister.discardPending();
		resolveFirstFlush?.();
		await Promise.all([firstFlushPromise, secondFlushPromise]);
		await persister.finish();

		expect(appendActiveStreamText).toHaveBeenCalledTimes(1);
		expect(appendActiveStreamText).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
			delta: "first",
		});
		expect(finishActiveStream).not.toHaveBeenCalled();
	});

	it("closes active stream persistence by flushing accepted text and rejecting later appends", async () => {
		vi.useFakeTimers();
		try {
			const startActiveStream = vi.fn().mockResolvedValue(undefined);
			const appendActiveStreamText = vi.fn().mockResolvedValue(undefined);
			const finishActiveStream = vi.fn().mockResolvedValue(undefined);
			const persister = new HostedActiveChatStreamPersister({
				workspaceId: "workspace-1",
				chatId: "chat-1",
				messageId: "stream-1",
				runId: "run-1",
				startActiveStream,
				appendActiveStreamText,
				finishActiveStream,
			});

			persister.append("accepted");
			await persister.closePersistence();
			persister.append(" ignored");
			vi.advanceTimersByTime(HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS);
			await persister.flush();

			expect(appendActiveStreamText).toHaveBeenCalledOnce();
			expect(appendActiveStreamText).toHaveBeenCalledWith({
				workspaceId: "workspace-1",
				chatId: "chat-1",
				runId: "run-1",
				delta: "accepted",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("owns active stream controller replacement and cleanup", async () => {
		const controllers = new Map();
		const existingPersister = {
			start: vi.fn().mockResolvedValue(undefined),
			append: vi.fn(),
			closePersistence: vi.fn().mockResolvedValue(undefined),
			finish: vi.fn().mockResolvedValue(undefined),
			discardPending: vi.fn(),
		};
		const start = vi.fn().mockResolvedValue(undefined);
		const append = vi.fn();
		const closePersistence = vi.fn().mockResolvedValue(undefined);
		const finish = vi.fn().mockResolvedValue(undefined);
		const streamKey = "workspace-1:chat-1";
		const existingSession = createTestActiveStreamSession({
			controllers,
			streamKey,
			persister: existingPersister,
		});
		await existingSession.start();
		const session = createTestActiveStreamSession({
			controllers,
			streamKey,
			persister: {
				start,
				append,
				closePersistence,
				finish,
			},
		});

		await session.start();
		expect(controllers.get(streamKey)).toBe(session);
		session.append("hello");
		await session.finish();

		expect(start).toHaveBeenCalledOnce();
		expect(append).toHaveBeenCalledWith("hello");
		expect(finish).toHaveBeenCalledWith();

		expect(existingSession.abortSignal.aborted).toBe(true);
		expect(existingPersister.discardPending).toHaveBeenCalledOnce();
		expect(controllers.has(streamKey)).toBe(false);
	});

	it("clears active-turn pending input during cleanup", () => {
		const session = createTestActiveStreamSession({
			controllers: new Map(),
			streamKey: "workspace-1:chat-1",
			persister: {
				start: vi.fn().mockResolvedValue(undefined),
				append: vi.fn(),
				closePersistence: vi.fn().mockResolvedValue(undefined),
				finish: vi.fn().mockResolvedValue(undefined),
			},
		});

		session.turnInput.extendSteerInput({ id: "queued-1", role: "user" });
		session.cleanup();

		expect(session.turnInput.hasPendingInput()).toBe(false);
		expect(session.turnInput.takeForCurrentTurn()).toEqual([]);
	});

	it("carries all pending input to a replacement active stream session", async () => {
		const controllers = new Map();
		const streamKey = "workspace-1:chat-1";
		const oldPersister = {
			start: vi.fn().mockResolvedValue(undefined),
			append: vi.fn(),
			closePersistence: vi.fn().mockResolvedValue(undefined),
			finish: vi.fn().mockResolvedValue(undefined),
			discardPending: vi.fn(),
		};
		const oldSession = createTestActiveStreamSession({
			controllers,
			streamKey,
			persister: oldPersister,
		});
		await oldSession.start();
		oldSession.turnInput.deferMailboxDeliveryToNextTurn();
		oldSession.turnInput.enqueueMailboxInput({
			id: "mailbox-1",
			role: "system",
		});
		oldSession.turnInput.extendSteerInput([
			{ id: "queued-1", role: "user" },
			{ id: "queued-2", role: "user" },
		]);

		const newSession = createTestActiveStreamSession({
			controllers,
			streamKey,
			persister: {
				start: vi.fn().mockResolvedValue(undefined),
				append: vi.fn(),
				closePersistence: vi.fn().mockResolvedValue(undefined),
				finish: vi.fn().mockResolvedValue(undefined),
			},
		});

		await newSession.start();

		expect(oldSession.abortSignal.aborted).toBe(true);
		expect(oldPersister.discardPending).toHaveBeenCalled();
		expect(oldSession.turnInput.hasPendingInput()).toBe(false);
		expect(newSession.turnInput.takeForCurrentTurn()).toEqual([
			{ id: "queued-1", role: "user" },
			{ id: "queued-2", role: "user" },
			{ id: "mailbox-1", role: "system" },
		]);
	});

	it("replaces closed stream controllers without aborting finalization", async () => {
		const controllers = new Map();
		const streamKey = "workspace-1:chat-1";
		const oldPersister = {
			start: vi.fn().mockResolvedValue(undefined),
			append: vi.fn(),
			closePersistence: vi.fn().mockResolvedValue(undefined),
			finish: vi.fn().mockResolvedValue(undefined),
			discardPending: vi.fn(),
		};
		const oldSession = createTestActiveStreamSession({
			controllers,
			streamKey,
			persister: oldPersister,
		});
		await oldSession.start();
		await collectStream(
			oldSession.startBroadcast(
				new ReadableStream({
					start(controller) {
						controller.close();
					},
				}),
			),
		);
		expect(oldSession.isBroadcastClosed()).toBe(true);

		const newPersister = {
			start: vi.fn().mockResolvedValue(undefined),
			append: vi.fn(),
			closePersistence: vi.fn().mockResolvedValue(undefined),
			finish: vi.fn().mockResolvedValue(undefined),
		};
		const newSession = createTestActiveStreamSession({
			controllers,
			streamKey,
			persister: newPersister,
		});

		await newSession.start();

		expect(oldSession.abortSignal.aborted).toBe(false);
		expect(oldPersister.discardPending).not.toHaveBeenCalled();
		expect(controllers.get(streamKey)).toBe(newSession);
	});

	it("cleans active stream controllers when session finish fails", async () => {
		const controllers = new Map();
		const streamKey = "workspace-1:chat-1";
		const finish = vi.fn().mockRejectedValue(new Error("finish failed"));
		const session = createTestActiveStreamSession({
			controllers,
			streamKey,
			persister: {
				start: vi.fn().mockResolvedValue(undefined),
				append: vi.fn(),
				closePersistence: vi.fn().mockResolvedValue(undefined),
				finish,
			},
		});

		await session.start();

		await expect(session.finish()).rejects.toThrow("finish failed");
		expect(controllers.has(streamKey)).toBe(false);
	});

	it("broadcasts active stream chunks to original and reconnect subscribers", async () => {
		const controllers = new Map();
		const streamKey = "workspace-1:chat-1";
		const session = createTestActiveStreamSession({
			controllers,
			streamKey,
			persister: {
				start: vi.fn().mockResolvedValue(undefined),
				append: vi.fn(),
				closePersistence: vi.fn().mockResolvedValue(undefined),
				finish: vi.fn().mockResolvedValue(undefined),
			},
		});
		const source = new ReadableStream<{ type: string; value: string }>({
			start(controller) {
				queueMicrotask(() => {
					controller.enqueue({ type: "text-delta", value: "one" });
					controller.enqueue({ type: "text-delta", value: "two" });
					controller.close();
				});
			},
		});

		await session.start();
		const originalStream = session.startBroadcast(source);
		const reconnectStream = session.subscribe();
		const [originalChunks, reconnectChunks] = await Promise.all([
			collectStream(originalStream),
			collectStream(reconnectStream),
		]);

		expect(originalChunks.map((chunk) => chunk.value)).toEqual(["one", "two"]);
		expect(reconnectChunks.map((chunk) => chunk.value)).toEqual(["one", "two"]);
		expect(controllers.get(streamKey)).toBe(session);

		session.cleanup();
		expect(controllers.has(streamKey)).toBe(false);
	});

	it("replays prior stream chunks to late reconnect subscribers", async () => {
		const controllers = new Map();
		const streamKey = "workspace-1:chat-1";
		const session = createTestActiveStreamSession({
			controllers,
			streamKey,
			persister: {
				start: vi.fn().mockResolvedValue(undefined),
				append: vi.fn(),
				closePersistence: vi.fn().mockResolvedValue(undefined),
				finish: vi.fn().mockResolvedValue(undefined),
			},
		});
		let sourceController:
			| ReadableStreamDefaultController<{
					type: string;
					id: string;
					delta?: string;
			  }>
			| undefined;
		const source = new ReadableStream<{
			type: string;
			id: string;
			delta?: string;
		}>({
			start(controller) {
				sourceController = controller;
			},
		});

		await session.start();
		const originalStream = session.startBroadcast(source);
		sourceController?.enqueue({ type: "text-start", id: "text-1" });
		sourceController?.enqueue({
			type: "text-delta",
			id: "text-1",
			delta: "hello",
		});
		await Promise.resolve();

		const reconnectStream = session.subscribe();
		sourceController?.enqueue({
			type: "text-delta",
			id: "text-1",
			delta: " world",
		});
		sourceController?.close();

		const [originalChunks, reconnectChunks] = await Promise.all([
			collectStream(originalStream),
			collectStream(reconnectStream),
		]);

		expect(originalChunks).toEqual([
			{ type: "text-start", id: "text-1" },
			{ type: "text-delta", id: "text-1", delta: "hello" },
			{ type: "text-delta", id: "text-1", delta: " world" },
		]);
		expect(reconnectChunks).toEqual(originalChunks);
		expect(controllers.get(streamKey)).toBe(session);

		session.cleanup();
		expect(controllers.has(streamKey)).toBe(false);
	});

	it("coalesces completed delta history for reconnect replay", async () => {
		const controllers = new Map();
		const streamKey = "workspace-1:chat-1";
		const session = createTestActiveStreamSession({
			controllers,
			streamKey,
			persister: {
				start: vi.fn().mockResolvedValue(undefined),
				append: vi.fn(),
				closePersistence: vi.fn().mockResolvedValue(undefined),
				finish: vi.fn().mockResolvedValue(undefined),
			},
		});
		const source = new ReadableStream({
			start(controller) {
				controller.enqueue({ type: "text-start", id: "text-1" });
				controller.enqueue({
					type: "text-delta",
					id: "text-1",
					delta: "hello",
				});
				controller.enqueue({
					type: "text-delta",
					id: "text-1",
					delta: " world",
				});
				controller.close();
			},
		});

		await session.start();
		await collectStream(session.startBroadcast(source));
		const replayedChunks = await collectStream(session.subscribe());

		expect(replayedChunks).toEqual([
			{ type: "text-start", id: "text-1" },
			{ type: "text-delta", id: "text-1", delta: "hello world" },
		]);
		session.cleanup();
	});

	it("creates chat-scoped active stream sessions through adapter callbacks", async () => {
		const controllers = new Map();
		const startActiveStream = vi.fn().mockResolvedValue(undefined);
		const appendActiveStreamText = vi.fn().mockResolvedValue(undefined);
		const finishActiveStream = vi.fn().mockResolvedValue(undefined);
		const session = createHostedActiveChatStreamSession({
			controllers,
			workspaceId: "workspace-1",
			chatId: "chat-1",
			messageId: "stream-1",
			runId: "run-1",
			callbacks: {
				startActiveStream,
				appendActiveStreamText,
				finishActiveStream,
			},
		});

		await session.start();
		expect(controllers.get("workspace-1:chat-1")).toBe(session);
		session.append("hello");
		await session.finish();

		expect(controllers.has("workspace-1:chat-1")).toBe(false);
		expect(startActiveStream).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
		});
		expect(appendActiveStreamText).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
			delta: "hello",
		});
		expect(finishActiveStream).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			runId: "run-1",
		});
	});

	it("pipes stream chunks while updating text snapshots and tool lifecycle state", async () => {
		const append = vi.fn();
		const startToolCall = vi.fn().mockResolvedValue(undefined);
		const finishToolCall = vi.fn().mockResolvedValue(undefined);
		const inputChunks = [
			{ type: "text-delta", delta: "hello" },
			{
				type: "tool-input-available",
				toolCallId: "tool-call-1",
				toolName: "search",
				input: { query: "graneri" },
			},
			{
				type: "tool-output-error",
				toolCallId: "tool-call-1",
				errorText: "search failed",
			},
			{ type: "text-delta", delta: " world" },
		];
		const stream = new ReadableStream<(typeof inputChunks)[number]>({
			start(controller) {
				for (const chunk of inputChunks) {
					controller.enqueue(chunk);
				}
				controller.close();
			},
		});

		const outputChunks = [];
		for await (const chunk of pipeHostedActiveStreamText({
			stream,
			persister: { append, startToolCall, finishToolCall },
		})) {
			outputChunks.push(chunk);
		}

		expect(outputChunks).toEqual(inputChunks);
		expect(append).toHaveBeenCalledTimes(2);
		expect(append).toHaveBeenNthCalledWith(1, "hello");
		expect(append).toHaveBeenNthCalledWith(2, " world");
		expect(startToolCall).toHaveBeenCalledWith({
			toolCallId: "tool-call-1",
			toolName: "search",
			input: { query: "graneri" },
		});
		expect(finishToolCall).toHaveBeenCalledWith({
			toolCallId: "tool-call-1",
			status: "failed",
			errorText: "search failed",
		});
	});

	it("runs stream terminalization after pending active stream text flushes", async () => {
		const events: string[] = [];
		const stream = new ReadableStream<{ type: string; delta: string }>({
			start(controller) {
				controller.enqueue({ type: "text-delta", delta: "hello" });
				controller.close();
			},
		});

		const outputChunks = [];
		for await (const chunk of pipeHostedActiveStreamText({
			onFlush: () => {
				events.push("terminalize");
			},
			stream,
			persister: {
				append: () => {
					events.push("append");
				},
				async flush() {
					events.push("flush");
				},
			},
		})) {
			outputChunks.push(chunk);
		}

		expect(outputChunks).toEqual([{ type: "text-delta", delta: "hello" }]);
		expect(events).toEqual(["append", "flush", "terminalize"]);
	});

	it("reports buffered text persistence failures before propagating stream errors", async () => {
		const failure = new Error("active stream append failed");
		const onError = vi.fn().mockResolvedValue(undefined);
		const stream = new ReadableStream<{ type: string; delta: string }>({
			start(controller) {
				controller.enqueue({ type: "text-delta", delta: "hello" });
				controller.close();
			},
		});

		const pipedStream = pipeHostedActiveStreamText({
			onError,
			stream,
			persister: {
				append: vi.fn(),
				flush: vi.fn().mockRejectedValue(failure),
			},
		});

		await expect(collectStream(pipedStream)).rejects.toThrow(
			"active stream append failed",
		);
		expect(onError).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(failure);
	});

	it("reports tool persistence failures before propagating stream errors", async () => {
		const failure = new Error("tool call persist failed");
		const onError = vi.fn().mockResolvedValue(undefined);
		const stream = new ReadableStream<{
			type: string;
			toolCallId: string;
			toolName: string;
			input: { query: string };
		}>({
			start(controller) {
				controller.enqueue({
					type: "tool-input-available",
					toolCallId: "tool-call-1",
					toolName: "search",
					input: { query: "graneri" },
				});
				controller.close();
			},
		});

		const pipedStream = pipeHostedActiveStreamText({
			onError,
			stream,
			persister: {
				append: vi.fn(),
				startToolCall: vi.fn().mockRejectedValue(failure),
			},
		});

		await expect(collectStream(pipedStream)).rejects.toThrow(
			"tool call persist failed",
		);
		expect(onError).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(failure);
	});
});
