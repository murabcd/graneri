import { Chat } from "@ai-sdk/react";
import type { ChatTransport, UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createBrowserFrameScheduler } from "../src/lib/browser-frame-scheduler";
import {
	createFrameBudgetedStream,
	FrameBudgetedChatTransport,
} from "../src/lib/frame-budgeted-chat-transport";

const collectStream = async <T>(stream: ReadableStream<T>) => {
	const reader = stream.getReader();
	const values: T[] = [];

	while (true) {
		const result = await reader.read();
		if (result.done) {
			return values;
		}

		values.push(result.value);
	}
};

const createControlledScheduler = () => {
	const callbacks: Array<() => void> = [];
	return {
		scheduleFrame: (callback: () => void) => {
			callbacks.push(callback);
			return () => {
				const index = callbacks.indexOf(callback);
				if (index >= 0) {
					callbacks.splice(index, 1);
				}
			};
		},
		runFrame: () => {
			const callback = callbacks.shift();
			callback?.();
		},
		get pendingFrames() {
			return callbacks.length;
		},
	};
};

const flushMicrotasks = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

describe("createFrameBudgetedStream", () => {
	it("drains queued chunks over frame-sized slices", async () => {
		const scheduler = createControlledScheduler();
		const stream = createFrameBudgetedStream(
			new ReadableStream<number>({
				start(controller) {
					controller.enqueue(1);
					controller.enqueue(2);
					controller.enqueue(3);
					controller.close();
				},
			}),
			{
				maxItemsPerFrame: 2,
				maxFrameMs: 100,
				scheduleFrame: scheduler.scheduleFrame,
				now: () => 0,
			},
		);
		const collected = collectStream(stream);

		await flushMicrotasks();
		expect(scheduler.pendingFrames).toBe(1);

		scheduler.runFrame();
		await flushMicrotasks();
		expect(scheduler.pendingFrames).toBe(1);

		scheduler.runFrame();
		await expect(collected).resolves.toEqual([1, 2, 3]);
	});

	it("keeps source reads bounded until queued chunks drain", async () => {
		const scheduler = createControlledScheduler();
		const totalValues = 20;
		let nextValue = 1;
		const stream = createFrameBudgetedStream(
			new ReadableStream<number>({
				pull(controller) {
					controller.enqueue(nextValue);
					nextValue += 1;

					if (nextValue > totalValues) {
						controller.close();
					}
				},
			}),
			{
				maxBufferedItems: 2,
				maxItemsPerFrame: 1,
				maxFrameMs: 100,
				scheduleFrame: scheduler.scheduleFrame,
				now: () => 0,
			},
		);
		const collected = collectStream(stream);

		await flushMicrotasks();
		expect(nextValue).toBeLessThan(totalValues);

		scheduler.runFrame();
		await flushMicrotasks();
		expect(nextValue).toBeLessThan(totalValues);

		while (scheduler.pendingFrames > 0) {
			scheduler.runFrame();
			await flushMicrotasks();
		}

		await expect(collected).resolves.toEqual(
			Array.from({ length: totalValues }, (_, index) => index + 1),
		);
	});

	it("stops draining frames while the downstream reader has no demand", async () => {
		const scheduler = createControlledScheduler();
		let nextValue = 1;
		const stream = createFrameBudgetedStream(
			new ReadableStream<number>({
				pull(controller) {
					controller.enqueue(nextValue);
					nextValue += 1;
				},
			}),
			{
				maxBufferedItems: 2,
				maxItemsPerFrame: 10,
				maxFrameMs: 100,
				scheduleFrame: scheduler.scheduleFrame,
				now: () => 0,
			},
		);
		const reader = stream.getReader();

		await flushMicrotasks();
		scheduler.runFrame();
		await flushMicrotasks();

		expect(scheduler.pendingFrames).toBe(0);
		expect(nextValue).toBeLessThanOrEqual(5);
		await expect(reader.read()).resolves.toEqual({ done: false, value: 1 });
		await flushMicrotasks();
		expect(scheduler.pendingFrames).toBe(0);
		await expect(reader.read()).resolves.toEqual({ done: false, value: 2 });

		await reader.cancel();
	});
});

describe("FrameBudgetedChatTransport", () => {
	it("paces send and reconnect streams", async () => {
		const scheduler = createControlledScheduler();
		const chunk = (delta: string): UIMessageChunk => ({
			type: "text-delta",
			id: "part-1",
			delta,
		});
		const createChunkStream = () =>
			new ReadableStream<UIMessageChunk>({
				start(controller) {
					controller.enqueue(chunk("a"));
					controller.enqueue(chunk("b"));
					controller.close();
				},
			});
		const baseTransport = {
			sendMessages: vi.fn(async () => createChunkStream()),
			reconnectToStream: vi.fn(async () => createChunkStream()),
		} satisfies ChatTransport;
		const transport = new FrameBudgetedChatTransport(baseTransport, {
			maxItemsPerFrame: 1,
			maxFrameMs: 100,
			scheduleFrame: scheduler.scheduleFrame,
			now: () => 0,
		});

		const sent = collectStream(
			await transport.sendMessages({
				abortSignal: undefined,
				chatId: "chat-1",
				messageId: undefined,
				messages: [],
				trigger: "submit-message",
			}),
		);
		await flushMicrotasks();
		while (scheduler.pendingFrames > 0) {
			scheduler.runFrame();
			await flushMicrotasks();
		}

		await expect(sent).resolves.toEqual([chunk("a"), chunk("b")]);

		const reconnected = collectStream(
			(await transport.reconnectToStream({ chatId: "chat-1" })) ??
				new ReadableStream<UIMessageChunk>(),
		);
		await flushMicrotasks();
		while (scheduler.pendingFrames > 0) {
			scheduler.runFrame();
			await flushMicrotasks();
		}

		await expect(reconnected).resolves.toEqual([chunk("a"), chunk("b")]);
	});
});

it("uses the available frame budget with a real SDK chat consumer", async () => {
	let frames = 0;
	const chunks: UIMessageChunk[] = [
		{ type: "start", messageId: "assistant" },
		{ type: "text-start", id: "text" },
		...Array.from(
			{ length: 600 },
			(): UIMessageChunk => ({ type: "text-delta", id: "text", delta: "x" }),
		),
		{ type: "text-end", id: "text" },
		{ type: "finish" },
	];
	const transport = new FrameBudgetedChatTransport(
		{
			sendMessages: async () =>
				new ReadableStream({
					start(controller) {
						for (const chunk of chunks) controller.enqueue(chunk);
						controller.close();
					},
				}),
			reconnectToStream: async () => null,
		},
		{
			maxItemsPerFrame: 120,
			now: () => 0,
			scheduleFrame: (callback) => {
				const id = setTimeout(() => {
					frames += 1;
					callback();
				}, 0);
				return () => clearTimeout(id);
			},
		},
	);
	const chat = new Chat({ transport });
	await chat.sendMessage({ text: "Test" });
	expect(chat.status).toBe("ready");
	expect(chat.messages.at(-1)?.parts).toEqual([
		{ type: "text", text: "x".repeat(600), state: "done" },
	]);
	expect(frames).toBe(Math.ceil(chunks.length / 120));
});

it("continues draining when a visible tab is hidden before its scheduled frame", async () => {
	vi.useFakeTimers();
	const visibility = Object.assign(new EventTarget(), {
		visibilityState: "visible" as DocumentVisibilityState,
	});
	const requestFrame = vi.fn(() => 7);
	const cancelFrame = vi.fn();
	const scheduleFrame = createBrowserFrameScheduler({
		document: visibility,
		requestAnimationFrame: requestFrame,
		cancelAnimationFrame: cancelFrame,
	});
	try {
		const stream = createFrameBudgetedStream(
			new ReadableStream<number>({
				start(controller) {
					controller.enqueue(1);
					controller.enqueue(2);
					controller.close();
				},
			}),
			{ maxItemsPerFrame: 1, scheduleFrame },
		);
		const collected = collectStream(stream);
		await flushMicrotasks();
		expect(requestFrame).toHaveBeenCalledOnce();
		visibility.visibilityState = "hidden";
		visibility.dispatchEvent(new Event("visibilitychange"));
		expect(cancelFrame).toHaveBeenCalledWith(7);
		await vi.runAllTimersAsync();
		await expect(collected).resolves.toEqual([1, 2]);
		expect(vi.getTimerCount()).toBe(0);
		visibility.visibilityState = "visible";
		visibility.dispatchEvent(new Event("visibilitychange"));
		expect(requestFrame).toHaveBeenCalledOnce();
	} finally {
		vi.useRealTimers();
	}
});

it("cancellation releases a hidden frame and its visibility listener", async () => {
	vi.useFakeTimers();
	const visibility = Object.assign(new EventTarget(), {
		visibilityState: "hidden" as DocumentVisibilityState,
	});
	const requestFrame = vi.fn(() => 7);
	const cancelSource = vi.fn();
	const scheduleFrame = createBrowserFrameScheduler({
		document: visibility,
		requestAnimationFrame: requestFrame,
		cancelAnimationFrame: vi.fn(),
	});
	try {
		const stream = createFrameBudgetedStream(
			new ReadableStream<number>({
				start(controller) {
					controller.enqueue(1);
				},
				cancel: cancelSource,
			}),
			{ scheduleFrame },
		);
		await flushMicrotasks();
		expect(vi.getTimerCount()).toBe(1);
		await stream.cancel();
		expect(cancelSource).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
		visibility.visibilityState = "visible";
		visibility.dispatchEvent(new Event("visibilitychange"));
		expect(requestFrame).not.toHaveBeenCalled();
	} finally {
		vi.useRealTimers();
	}
});
