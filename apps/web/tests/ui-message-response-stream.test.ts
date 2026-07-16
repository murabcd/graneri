import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { pipeUiMessageStreamToServerResponse } from "../server/ui-message-response-stream";

class TestServerResponse extends EventEmitter {
	readonly headers = new Map<string, string>();
	readonly writes: Uint8Array[] = [];
	destroyed = false;
	writableEnded = false;
	shouldApplyBackpressure = true;

	hasHeader(name: string) {
		return this.headers.has(name.toLowerCase());
	}

	setHeader(name: string, value: number | string | readonly string[]) {
		this.headers.set(name.toLowerCase(), String(value));
		return this;
	}

	write(value: Uint8Array) {
		this.writes.push(value);
		if (this.shouldApplyBackpressure) {
			this.shouldApplyBackpressure = false;
			return false;
		}
		return true;
	}

	end() {
		this.writableEnded = true;
		return this;
	}
}

const flushMicrotasks = async () => {
	for (let index = 0; index < 5; index += 1) {
		await Promise.resolve();
	}
};

describe("UI message response stream", () => {
	it("waits for Node response drain before reading the next SSE chunk", async () => {
		const testResponse = new TestServerResponse();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue({ type: "text-start", id: "text-1" } as const);
				controller.enqueue({
					type: "text-delta",
					id: "text-1",
					delta: "hello",
				} as const);
				controller.close();
			},
		});
		const completion = pipeUiMessageStreamToServerResponse({
			response: testResponse as unknown as ServerResponse,
			stream,
		});
		await flushMicrotasks();

		expect(testResponse.writes).toHaveLength(1);
		expect(testResponse.writableEnded).toBe(false);
		testResponse.emit("drain");
		await completion;

		expect(testResponse.writes).toHaveLength(3);
		expect(testResponse.writableEnded).toBe(true);
		expect(testResponse.headers.get("content-type")).toBe("text/event-stream");
	});

	it("cancels the stream when the HTTP response closes", async () => {
		const cancel = vi.fn();
		const testResponse = new TestServerResponse();
		const stream = new ReadableStream(
			{
				pull(controller) {
					controller.enqueue({ type: "text-start", id: "text-1" } as const);
				},
				cancel,
			},
			{ highWaterMark: 0 },
		);
		const completion = pipeUiMessageStreamToServerResponse({
			response: testResponse as unknown as ServerResponse,
			stream,
		});
		await flushMicrotasks();

		testResponse.destroyed = true;
		testResponse.emit("close");
		await completion;
		await flushMicrotasks();

		expect(cancel).toHaveBeenCalledWith("HTTP response closed");
		expect(testResponse.writableEnded).toBe(false);
	});
});
