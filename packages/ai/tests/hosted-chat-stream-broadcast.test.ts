import { describe, expect, it } from "vitest";
import {
	createHostedChatStreamBroadcast,
	HOSTED_STREAM_MAX_REPLAY_BYTES,
	HOSTED_STREAM_MAX_REPLAY_CHUNKS,
	HOSTED_STREAM_MAX_SUBSCRIBERS,
} from "../src/hosted-chat-stream-broadcast.mjs";

const collectStream = async <T>(stream: ReadableStream<T>) => {
	const values: T[] = [];
	for await (const value of stream) {
		values.push(value);
	}
	return values;
};

const flushMicrotasks = async () => {
	for (let index = 0; index < 5; index += 1) {
		await Promise.resolve();
	}
};

describe("hosted chat stream broadcast", () => {
	it("does not read another upstream chunk without subscriber demand", async () => {
		const broadcast = createHostedChatStreamBroadcast();
		let pullCount = 0;
		const source = new ReadableStream<number>(
			{
				pull(controller) {
					pullCount += 1;
					controller.enqueue(pullCount);
					if (pullCount === 2) {
						controller.close();
					}
				},
			},
			{ highWaterMark: 0 },
		);
		const reader = broadcast.start(source).getReader();
		await flushMicrotasks();

		expect(pullCount).toBe(1);
		await expect(reader.read()).resolves.toEqual({ done: false, value: 1 });
		await flushMicrotasks();
		expect(pullCount).toBe(2);
		await expect(reader.read()).resolves.toEqual({ done: false, value: 2 });
		await expect(reader.read()).resolves.toEqual({
			done: true,
			value: undefined,
		});
	});

	it("bounds replay chunk count without interrupting the live subscriber", async () => {
		const broadcast = createHostedChatStreamBroadcast();
		const chunkCount = HOSTED_STREAM_MAX_REPLAY_CHUNKS + 1;
		const source = new ReadableStream(
			{
				start(controller) {
					for (let index = 0; index < chunkCount; index += 1) {
						controller.enqueue({ type: "data-event", index });
					}
					controller.close();
				},
			},
			{ highWaterMark: 0 },
		);

		await expect(collectStream(broadcast.start(source))).resolves.toHaveLength(
			chunkCount,
		);
		await expect(collectStream(broadcast.subscribe())).rejects.toThrow(
			"replay capacity was exceeded",
		);
	});

	it("bounds replay bytes without interrupting the live subscriber", async () => {
		const broadcast = createHostedChatStreamBroadcast();
		const oversizedChunk = {
			type: "data-event",
			value: "x".repeat(HOSTED_STREAM_MAX_REPLAY_BYTES),
		};
		const source = new ReadableStream({
			start(controller) {
				controller.enqueue(oversizedChunk);
				controller.close();
			},
		});

		await expect(collectStream(broadcast.start(source))).resolves.toEqual([
			oversizedChunk,
		]);
		await expect(collectStream(broadcast.subscribe())).rejects.toThrow(
			"replay capacity was exceeded",
		);
	});

	it("rejects excess subscribers without retaining another stream", async () => {
		const broadcast = createHostedChatStreamBroadcast();
		const retainedStreams = Array.from(
			{ length: HOSTED_STREAM_MAX_SUBSCRIBERS },
			() => broadcast.subscribe(),
		);

		await expect(collectStream(broadcast.subscribe())).rejects.toThrow(
			"subscriber capacity was exceeded",
		);
		broadcast.close();
		await Promise.all(retainedStreams.map(collectStream));
	});

	it("cancels the upstream reader when a blocked broadcast closes", async () => {
		let cancelReason: unknown;
		const source = new ReadableStream(
			{
				pull(controller) {
					controller.enqueue("chunk");
				},
				cancel(reason) {
					cancelReason = reason;
				},
			},
			{ highWaterMark: 0 },
		);
		const broadcast = createHostedChatStreamBroadcast();
		broadcast.start(source);
		await flushMicrotasks();

		broadcast.close("cleanup");
		await flushMicrotasks();

		expect(cancelReason).toBe("cleanup");
	});
});
