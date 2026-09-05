import { describe, expect, it, vi } from "vitest";
import { stopOrphanedHostedAssistantRun } from "../src/hosted-chat-orphaned-run.mjs";

describe("hosted chat orphaned run cleanup", () => {
	it("retains orphaned runs when snapshot persistence fails", async () => {
		const calls: string[] = [];
		const requestStopAssistantRun = vi.fn(async () => {
			calls.push("requestStopAssistantRun");
		});
		const stopActiveStream = vi.fn(async () => {
			calls.push("stopActiveStream");
			throw new Error("active stream cleanup failed");
		});
		const finishStoppedAssistantRun = vi.fn(async () => {
			calls.push("finishStoppedAssistantRun");
		});

		await expect(
			stopOrphanedHostedAssistantRun({
				chatId: "chat-1",
				assistantMessageId: "assistant-1",
				finishStoppedAssistantRun,
				logLatency: vi.fn(),
				requestStopAssistantRun,
				runId: "run-1",
				stopActiveStream,
				workspaceId: "workspace-1",
			}),
		).rejects.toThrow("active stream cleanup failed");

		expect(calls).toEqual(["requestStopAssistantRun", "stopActiveStream"]);
		expect(finishStoppedAssistantRun).not.toHaveBeenCalled();
		stopActiveStream.mockImplementationOnce(async () => {
			calls.push("stopActiveStream");
		});
		await stopOrphanedHostedAssistantRun({
			chatId: "chat-1",
			assistantMessageId: "assistant-1",
			finishStoppedAssistantRun,
			logLatency: vi.fn(),
			requestStopAssistantRun,
			runId: "run-1",
			stopActiveStream,
			workspaceId: "workspace-1",
		});
		expect(calls.slice(-3)).toEqual([
			"requestStopAssistantRun",
			"stopActiveStream",
			"finishStoppedAssistantRun",
		]);
	});
});
