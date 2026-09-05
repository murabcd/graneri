import { expect, it, vi } from "vitest";
import { HostedActiveChatStreamPersister } from "../src/hosted-chat-active-stream.mjs";

it("coalesces repeated flush requests behind a blocked write and drains the final snapshot", async () => {
	const blocked = Promise.withResolvers<void>();
	const updateActiveStream = vi
		.fn()
		.mockReturnValueOnce(blocked.promise)
		.mockResolvedValue(undefined);
	const finishActiveStream = vi.fn().mockResolvedValue(undefined);
	const persister = new HostedActiveChatStreamPersister({
		workspaceId: "workspace",
		chatId: "chat",
		messageId: "assistant",
		runId: "run",
		startActiveStream: async () => undefined,
		updateActiveStream,
		finishActiveStream,
	});
	persister.append("0");
	persister.replaceParts([{ type: "text", text: "0" }]);
	const writes = [persister.flush()];
	await Promise.resolve();
	for (let index = 1; index <= 20; index++) {
		persister.append(String(index));
		persister.replaceParts([{ type: "text", text: `snapshot-${index}` }]);
		writes.push(persister.flush());
		await Promise.resolve();
	}
	const finished = persister.finish();
	expect(updateActiveStream).toHaveBeenCalledTimes(1);
	expect(finishActiveStream).not.toHaveBeenCalled();
	blocked.resolve();
	await Promise.all([...writes, finished]);
	expect(updateActiveStream).toHaveBeenCalledTimes(2);
	expect(updateActiveStream.mock.calls[1]?.[0]).toMatchObject({
		delta: Array.from({ length: 20 }, (_, index) => String(index + 1)).join(""),
		partsJson: JSON.stringify([{ type: "text", text: "snapshot-20" }]),
	});
	expect(finishActiveStream).toHaveBeenCalledTimes(1);
});

it("waits for data accepted while another empty drain is settling", async () => {
	const blocked = Promise.withResolvers<void>();
	const updateActiveStream = vi.fn().mockReturnValue(blocked.promise);
	const persister = new HostedActiveChatStreamPersister({
		workspaceId: "workspace",
		chatId: "chat",
		messageId: "assistant",
		runId: "run",
		startActiveStream: async () => undefined,
		updateActiveStream,
		finishActiveStream: async () => undefined,
	});
	const empty = persister.flush();
	persister.append("final");
	let closed = false;
	const closing = persister.closePersistence().then(() => {
		closed = true;
	});
	for (let tick = 0; tick < 10; tick++) await Promise.resolve();
	expect(updateActiveStream).toHaveBeenCalledTimes(1);
	expect(closed).toBe(false);
	blocked.resolve();
	await Promise.all([empty, closing]);
	expect(updateActiveStream.mock.calls[0]?.[0]).toMatchObject({
		delta: "final",
	});
});

it("never finalizes after a failed write, including repeated finish attempts", async () => {
	const failed = new Error("write failed");
	const updateActiveStream = vi.fn().mockRejectedValue(failed);
	const finishActiveStream = vi.fn();
	const persister = new HostedActiveChatStreamPersister({
		workspaceId: "workspace",
		chatId: "chat",
		messageId: "assistant",
		runId: "run",
		startActiveStream: async () => undefined,
		updateActiveStream,
		finishActiveStream,
	});
	persister.append("partial");
	await expect(persister.flush()).rejects.toBe(failed);
	await expect(persister.finish()).rejects.toBe(failed);
	await expect(persister.finish()).rejects.toBe(failed);
	expect(updateActiveStream).toHaveBeenCalledTimes(1);
	expect(finishActiveStream).not.toHaveBeenCalled();
});
