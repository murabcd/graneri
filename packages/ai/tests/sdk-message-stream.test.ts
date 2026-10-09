import { readUIMessageStream, type UIMessageChunk } from "ai";
import { expect, it, vi } from "vitest";

it("limits source reads for a paused consumer and forwards cancellation", async () => {
	const cancel = vi.fn();
	let pulls = 0;
	const stream = new ReadableStream<UIMessageChunk>(
		{
			pull(controller) {
				pulls += 1;
				controller.enqueue(
					pulls === 1
						? { type: "text-start", id: "text" }
						: { type: "text-delta", id: "text", delta: "x" },
				);
			},
			cancel,
		},
		{ highWaterMark: 0 },
	);
	const reader = readUIMessageStream({ stream }).getReader();
	await reader.read();
	await new Promise((resolve) => setTimeout(resolve, 0));
	const pausedPulls = pulls;
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(pulls).toBe(pausedPulls);
	expect(pulls).toBeLessThan(10);
	await reader.cancel("consumer stopped");
	await vi.waitFor(() =>
		expect(cancel).toHaveBeenCalledWith("consumer stopped"),
	);
	reader.releaseLock();
});

it("resets state between message IDs while preserving earlier snapshots", async () => {
	const stream = new ReadableStream<UIMessageChunk>({
		start(controller) {
			for (const messageId of ["first", "second"]) {
				controller.enqueue({ type: "start", messageId });
				controller.enqueue({ type: "text-start", id: "text" });
				controller.enqueue({
					type: "text-delta",
					id: "text",
					delta: messageId,
				});
				controller.enqueue({ type: "text-end", id: "text" });
				controller.enqueue({ type: "finish" });
			}
			controller.close();
		},
	});
	const snapshots = [];
	for await (const message of readUIMessageStream({ stream })) {
		snapshots.push(message);
	}
	for (const messageId of ["first", "second"]) {
		expect(
			snapshots.find((message) => message.id === messageId)?.parts,
		).toEqual([]);
		expect(
			snapshots.findLast((message) => message.id === messageId)?.parts,
		).toEqual([{ type: "text", text: messageId, state: "done" }]);
	}
});
