import { describe, expect, it } from "vitest";
import { createHostedChatRunResponseStream } from "../src/hosted-chat-stream-lifecycle.mjs";

const createActiveStreamSession = ({
	replaceParts,
}: {
	replaceParts?: (parts: unknown[]) => void;
} = {}) => {
	const abortController = new AbortController();
	const persistedText: string[] = [];
	const persistedParts: unknown[][] = [];
	let cleanedUp = false;
	let persistenceClosed = false;
	let broadcastStarted = false;

	return {
		get broadcastStarted() {
			return broadcastStarted;
		},
		get cleanedUp() {
			return cleanedUp;
		},
		get persistedText() {
			return persistedText;
		},
		get persistedParts() {
			return persistedParts;
		},
		get persistenceClosed() {
			return persistenceClosed;
		},
		session: {
			abortSignal: abortController.signal,
			append: (delta: string) => persistedText.push(delta),
			replaceParts: (parts: unknown[]) => {
				persistedParts.push(parts);
				replaceParts?.(parts);
			},
			cleanup: () => {
				cleanedUp = true;
			},
			closePersistence: async () => {
				persistenceClosed = true;
			},
			startBroadcast: (stream: ReadableStream<{ type: string }>) => {
				broadcastStarted = true;
				return stream;
			},
		},
	};
};

const createStreamLatencyTracker = () => ({
	getFinishDetails: () => ({ finished: true }),
	wrapStream: (stream: ReadableStream<{ type: string }>) => stream,
});

describe("hosted chat stream lifecycle", () => {
	it("creates a broadcast stream and flushes completed finalization after the stream is consumed", async () => {
		const activeStream = createActiveStreamSession();
		const finalized: unknown[] = [];
		const latencyStages: string[] = [];
		const result = await createHostedChatRunResponseStream({
			activeStreamSession: activeStream.session,
			agent: {},
			assistantMessageId: "assistant-message-1",
			assistantRunId: "run-1",
			chatMessages: [
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "Hello" }],
				},
			],
			createUiStream: async ({ onEnd }) => {
				onEnd({
					isAborted: false,
					responseMessage: {
						id: "assistant-message-1",
						role: "assistant",
						parts: [{ type: "text", text: "Hi" }],
					},
				});
				return new ReadableStream({
					start(controller) {
						controller.enqueue({ type: "text-start", id: "text-1" });
						controller.enqueue({
							type: "text-delta",
							id: "text-1",
							delta: "Hi",
						});
						controller.enqueue({ type: "text-end", id: "text-1" });
						controller.close();
					},
				});
			},
			failAssistantRun: async () => {
				throw new Error("run should not fail");
			},
			finalizeAssistantRun: async (terminalization) => {
				finalized.push(terminalization);
			},
			finalizedToolSet: { hasTools: true },
			logLatency: (stage) => latencyStages.push(stage),
			streamLatencyTracker: createStreamLatencyTracker(),
			instructions: "instructions",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		const chunks = [];
		for await (const chunk of result.responseStream) {
			chunks.push(chunk);
		}
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(activeStream.broadcastStarted).toBe(true);
		expect(activeStream.persistedParts.at(-1)).toEqual([
			{ type: "text", text: "Hi", state: "done" },
		]);
		expect(chunks).toEqual([
			{ type: "text-start", id: "text-1" },
			{ type: "text-delta", id: "text-1", delta: "Hi" },
			{ type: "text-end", id: "text-1" },
		]);
		expect(finalized).toEqual([
			{
				responseMessage: {
					id: "assistant-message-1",
					role: "assistant",
					parts: [{ type: "text", text: "Hi" }],
				},
				status: "completed",
			},
		]);
		expect(latencyStages).toContain("ai.agent_created");
		expect(latencyStages).toContain("stream.finish");
		expect(latencyStages).toContain("ai.stream_created");
	});

	it("fails the assistant run and cleans up when stream creation fails", async () => {
		const activeStream = createActiveStreamSession();
		const failedRuns: unknown[] = [];
		const errors: unknown[] = [];
		const result = await createHostedChatRunResponseStream({
			activeStreamSession: activeStream.session,
			agent: {},
			assistantMessageId: "assistant-message-1",
			assistantRunId: "run-1",
			chatMessages: [],
			createUiStream: async () => {
				throw new Error("stream failed");
			},
			failAssistantRun: async (args) => {
				failedRuns.push(args);
			},
			finalizeAssistantRun: async () => {
				throw new Error("run should not finalize");
			},
			finalizedToolSet: { hasTools: false },
			logLatency: () => undefined,
			onStreamCreateError: (error) => {
				errors.push(error);
			},
			streamLatencyTracker: createStreamLatencyTracker(),
			instructions: "instructions",
		});

		expect(result.ok).toBe(false);
		expect(activeStream.cleanedUp).toBe(true);
		expect(activeStream.broadcastStarted).toBe(false);
		expect(failedRuns).toEqual([
			{
				errorText: "stream failed",
				runId: "run-1",
			},
		]);
		expect(errors).toHaveLength(1);
	});

	it("fails finalization when rich snapshot persistence fails", async () => {
		const snapshotError = new Error("snapshot persistence failed");
		const activeStream = createActiveStreamSession({
			replaceParts: () => {
				throw snapshotError;
			},
		});
		const finalized: unknown[] = [];
		const result = await createHostedChatRunResponseStream({
			activeStreamSession: activeStream.session,
			agent: {},
			assistantMessageId: "assistant-message-1",
			assistantRunId: "run-1",
			chatMessages: [],
			createUiStream: async ({ onEnd }) => {
				onEnd({
					isAborted: false,
					responseMessage: {
						id: "assistant-message-1",
						role: "assistant",
						parts: [{ type: "text", text: "Hi" }],
					},
				});
				return new ReadableStream({
					start(controller) {
						controller.enqueue({ type: "text-start", id: "text-1" });
						controller.enqueue({
							type: "text-delta",
							id: "text-1",
							delta: "Hi",
						});
						controller.enqueue({ type: "text-end", id: "text-1" });
						controller.close();
					},
				});
			},
			failAssistantRun: async () => undefined,
			finalizeAssistantRun: async (terminalization) => {
				finalized.push(terminalization);
			},
			finalizedToolSet: { hasTools: false },
			logLatency: () => undefined,
			streamLatencyTracker: createStreamLatencyTracker(),
			instructions: "instructions",
		});

		if (!result.ok) {
			throw result.error;
		}
		await expect(
			(async () => {
				for await (const _chunk of result.responseStream) {
					// Consume until the snapshot persistence failure reaches the stream.
				}
			})(),
		).rejects.toThrow("snapshot persistence failed");
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(finalized).toEqual([
			{
				errorText: "snapshot persistence failed",
				status: "failed",
			},
		]);
	});

	it("finalizes an SDK approval request as waiting for the user", async () => {
		const activeStream = createActiveStreamSession();
		const finalized: unknown[] = [];
		const result = await createHostedChatRunResponseStream({
			activeStreamSession: activeStream.session,
			agent: {},
			assistantMessageId: "assistant-message-1",
			assistantRunId: "run-1",
			chatMessages: [],
			createUiStream: async ({ onEnd }) => {
				onEnd({
					isAborted: false,
					responseMessage: {
						id: "assistant-message-1",
						role: "assistant",
						parts: [
							{
								type: "tool-delete_automation",
								toolCallId: "call-1",
								input: { automationId: "automation-1" },
								approval: { id: "approval-1" },
								state: "approval-requested",
							},
						],
					},
				});
				return new ReadableStream({
					start: (controller) => controller.close(),
				});
			},
			failAssistantRun: async () => undefined,
			finalizeAssistantRun: async (terminalization) => {
				finalized.push(terminalization);
			},
			finalizedToolSet: { hasTools: true },
			logLatency: () => undefined,
			streamLatencyTracker: createStreamLatencyTracker(),
			instructions: "instructions",
		});

		if (!result.ok) {
			throw result.error;
		}
		for await (const _chunk of result.responseStream) {
			// Consume the stream so queued finalization flushes.
		}
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(finalized).toEqual([
			expect.objectContaining({
				pendingDecision: {
					type: "tool_approval",
					approvalId: "approval-1",
					assistantMessageId: "assistant-message-1",
					toolCallId: "call-1",
					toolName: "delete_automation",
				},
				status: "waiting_for_user",
			}),
		]);
	});
});
