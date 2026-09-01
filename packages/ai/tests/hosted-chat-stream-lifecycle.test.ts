import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
	buildHostedSteeredGenerationTranscript,
	createHostedChatRunResponseStream,
} from "../src/hosted-chat-stream-lifecycle.mjs";

const createActiveStreamSession = ({
	openSteeredUserMessageAcceptance = () => undefined,
	replaceParts,
	takePendingSteeredUserMessages = () => [],
	takeSteeredUserMessageGenerationBoundary,
	transitionGeneration,
	waitForSteeredUserMessageReservations = async () => undefined,
}: {
	openSteeredUserMessageAcceptance?: () => void;
	replaceParts?: (parts: unknown[]) => void;
	takePendingSteeredUserMessages?: () => UIMessage[];
	takeSteeredUserMessageGenerationBoundary?: () => {
		consumed: Array<{ input: UIMessage[]; stepNumber: number }>;
		pending: UIMessage[];
		steerAcceptances?: Array<{
			queuedMessageId: string;
			claimVersion: number;
			messageId: string;
		}>;
	};
	transitionGeneration?: (args: unknown) => Promise<void>;
	waitForSteeredUserMessageReservations?: () => Promise<void>;
} = {}) => {
	const abortController = new AbortController();
	const persistedText: string[] = [];
	const persistedParts: unknown[][] = [];
	let cleanedUp = false;
	let steerAcceptanceClosed = false;
	let persistenceClosed = false;
	let broadcastStarted = false;
	const generationTransitions: unknown[] = [];

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
		get steerAcceptanceClosed() {
			return steerAcceptanceClosed;
		},
		get generationTransitions() {
			return generationTransitions;
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
			closeSteeredUserMessageAcceptance: () => {
				steerAcceptanceClosed = true;
			},
			openSteeredUserMessageAcceptance,
			startBroadcast: (stream: ReadableStream<{ type: string }>) => {
				broadcastStarted = true;
				return stream;
			},
			takePendingSteeredUserMessages,
			takeSteeredUserMessageGenerationBoundary:
				takeSteeredUserMessageGenerationBoundary
					? () => {
							const boundary = takeSteeredUserMessageGenerationBoundary();
							return {
								...boundary,
								steerAcceptances: boundary.steerAcceptances ?? [],
							};
						}
					: () => ({
							consumed: [],
							pending: takePendingSteeredUserMessages(),
							steerAcceptances: [],
						}),
			transitionGeneration: async (args: unknown) => {
				generationTransitions.push(args);
				await transitionGeneration?.(args);
			},
			waitForSteeredUserMessageReservations,
		},
	};
};

const createStreamLatencyTracker = () => ({
	getFinishDetails: () => ({ finished: true }),
	wrapStream: (stream: ReadableStream<{ type: string }>) => stream,
});

describe("hosted chat stream lifecycle", () => {
	it("interleaves consumed B and pending C at their generation boundaries", () => {
		const transcript = buildHostedSteeredGenerationTranscript({
			consumed: [
				{
					input: [
						{
							id: "user-b",
							role: "user",
							parts: [{ type: "text", text: "B" }],
						},
					],
					stepNumber: 1,
				},
			],
			pending: [
				{
					id: "user-c",
					role: "user",
					parts: [{ type: "text", text: "C" }],
				},
			],
			responseMessage: {
				id: "assistant-a",
				role: "assistant",
				parts: [
					{ type: "step-start" },
					{ type: "text", text: "A" },
					{ type: "step-start" },
					{ type: "text", text: "B response" },
				],
			},
		});

		expect(transcript.map((message) => message.role)).toEqual([
			"assistant",
			"user",
			"assistant",
			"user",
		]);
		expect(transcript.map((message) => message.id)).toMatchObject([
			"assistant-a",
			"user-b",
			expect.stringMatching(/^stream-/),
			"user-c",
		]);
		expect(transcript[0]?.parts).toEqual([
			{ type: "step-start" },
			{ type: "text", text: "A" },
		]);
		expect(transcript[2]?.parts).toEqual([
			{ type: "step-start" },
			{ type: "text", text: "B response" },
		]);
	});

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

	it("waits for a reserved steer acceptance at a waiting-for-user boundary", async () => {
		let resolveReservation: (() => void) | undefined;
		const reservationReleased = new Promise<void>((resolve) => {
			resolveReservation = resolve;
		});
		let markTerminalBoundaryReached: (() => void) | undefined;
		const terminalBoundaryReached = new Promise<void>((resolve) => {
			markTerminalBoundaryReached = resolve;
		});
		let pendingSteerInputs: UIMessage[] = [];
		let activeStream: ReturnType<typeof createActiveStreamSession>;
		activeStream = createActiveStreamSession({
			takePendingSteeredUserMessages: () => {
				const inputs = pendingSteerInputs;
				pendingSteerInputs = [];
				return inputs;
			},
			waitForSteeredUserMessageReservations: async () => {
				expect(activeStream.steerAcceptanceClosed).toBe(true);
				markTerminalBoundaryReached?.();
				await reservationReleased;
			},
		});
		const executionInputs: UIMessage[][] = [];
		const finalized: unknown[] = [];
		let executionCount = 0;
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
			createUiStream: async ({ onEnd, uiMessages }) => {
				executionInputs.push(uiMessages);
				executionCount += 1;
				onEnd({
					isAborted: false,
					responseMessage: {
						id: "assistant-message-1",
						role: "assistant",
						parts:
							executionCount === 1
								? [
										{
											type: "text",
											text: "Long answer",
											providerMetadata: {
												openai: { itemId: "generation-bound" },
											},
										},
										{
											type: "tool-delete_automation",
											toolCallId: "call-waiting",
											input: { automationId: "automation-1" },
											approval: { id: "approval-waiting" },
											state: "approval-requested",
										},
									]
								: [{ type: "text", text: "Short answer" }],
					},
				});
				return new ReadableStream({
					start(controller) {
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
			finalizedToolSet: { hasTools: false },
			instructions: "instructions",
			logLatency: () => undefined,
			streamLatencyTracker: createStreamLatencyTracker(),
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		const consumeResponse = (async () => {
			for await (const _chunk of result.responseStream) {
				// Consuming the response commits the single terminalization.
			}
		})();
		await terminalBoundaryReached;
		pendingSteerInputs = [
			{
				id: "user-steer-1",
				role: "user",
				parts: [{ type: "text", text: "Use a shorter answer." }],
			},
		];
		resolveReservation?.();
		await consumeResponse;
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(executionInputs).toHaveLength(1);
		expect(finalized).toEqual([
			expect.objectContaining({
				pendingDecision: expect.objectContaining({
					assistantMessageId: "assistant-message-1",
					approvalId: "approval-waiting",
				}),
				status: "waiting_for_user",
			}),
		]);
		expect(activeStream.steerAcceptanceClosed).toBe(true);
	});

	it("rotates a consumed steer before preserving a waiting decision", async () => {
		let boundaryRead = false;
		const activeStream = createActiveStreamSession({
			takeSteeredUserMessageGenerationBoundary: () => {
				if (boundaryRead) {
					return { consumed: [], pending: [] };
				}
				boundaryRead = true;
				return {
					consumed: [
						{
							input: [
								{
									id: "user-steer-1",
									role: "user",
									parts: [{ type: "text", text: "Steer" }],
								},
							],
							stepNumber: 1,
						},
					],
					pending: [],
				};
			},
		});
		const finalized: unknown[] = [];
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
						parts: [
							{ type: "step-start" },
							{ type: "text", text: "First segment" },
							{ type: "step-start" },
							{ type: "text", text: "Second segment" },
							{
								type: "tool-delete_automation",
								toolCallId: "call-waiting",
								input: { automationId: "automation-1" },
								approval: { id: "approval-waiting" },
								state: "approval-requested",
							},
						],
					},
				});
				return new ReadableStream({
					start(controller) {
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
			finalizedToolSet: { hasTools: false },
			instructions: "instructions",
			logLatency: () => undefined,
			streamLatencyTracker: createStreamLatencyTracker(),
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		for await (const _chunk of result.responseStream) {
			// Consuming the response commits the waiting terminalization.
		}
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(activeStream.generationTransitions).toHaveLength(1);
		const transition = activeStream.generationTransitions[0] as {
			nextAssistantMessageId: string;
		};
		expect(transition.nextAssistantMessageId).toMatch(/^stream-/);
		expect(finalized).toEqual([
			expect.objectContaining({
				responseMessage: expect.objectContaining({
					id: transition.nextAssistantMessageId,
				}),
				status: "waiting_for_user",
			}),
		]);
	});

	it("keeps consumed B in the evolving transcript when pending C starts replacement", async () => {
		let boundaryRead = false;
		const activeStream = createActiveStreamSession({
			takeSteeredUserMessageGenerationBoundary: () => {
				if (boundaryRead) {
					return { consumed: [], pending: [] };
				}
				boundaryRead = true;
				return {
					consumed: [
						{
							input: [
								{
									id: "user-b",
									role: "user",
									parts: [{ type: "text", text: "B" }],
								},
							],
							stepNumber: 1,
						},
					],
					pending: [
						{
							id: "user-c",
							role: "user",
							parts: [{ type: "text", text: "C" }],
						},
					],
				};
			},
		});
		const executionInputs: UIMessage[][] = [];
		let executionCount = 0;
		const finalized: unknown[] = [];
		const result = await createHostedChatRunResponseStream({
			activeStreamSession: activeStream.session,
			agent: {},
			assistantMessageId: "assistant-a",
			assistantRunId: "run-1",
			chatMessages: [
				{
					id: "user-a",
					role: "user",
					parts: [{ type: "text", text: "A" }],
				},
			],
			createUiStream: async ({ generateMessageId, onEnd, uiMessages }) => {
				executionInputs.push(uiMessages);
				executionCount += 1;
				onEnd({
					isAborted: false,
					responseMessage: {
						id: generateMessageId(),
						role: "assistant",
						parts:
							executionCount === 1
								? [
										{ type: "step-start" },
										{
											type: "text",
											text: "A response",
											providerMetadata: {
												openai: { itemId: "generation-a" },
											},
										},
										{ type: "step-start" },
										{
											type: "text",
											text: "B response",
											providerMetadata: {
												openai: { itemId: "generation-b" },
											},
										},
									]
								: [{ type: "text", text: "C response" }],
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
			finalizedToolSet: { hasTools: false },
			instructions: "instructions",
			logLatency: () => undefined,
			streamLatencyTracker: createStreamLatencyTracker(),
		});

		if (!result.ok) {
			throw result.error;
		}
		for await (const _chunk of result.responseStream) {
			// Consume the complete replacement lifecycle.
		}
		await new Promise((resolve) => setTimeout(resolve, 0));

		const replacementInput = executionInputs[1] ?? [];
		expect(replacementInput.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
		]);
		expect(replacementInput.map((message) => message.id)).toEqual([
			"user-a",
			"assistant-a",
			"user-b",
			expect.stringMatching(/^stream-/),
			"user-c",
		]);
		expect(
			replacementInput.map((message) =>
				message.parts
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join(""),
			),
		).toEqual(["A", "A response", "B", "B response", "C"]);
		for (const assistantMessage of executionInputs[1]?.filter(
			(message) => message.role === "assistant",
		) ?? []) {
			for (const part of assistantMessage.parts) {
				if ("providerMetadata" in part) {
					expect(part.providerMetadata?.openai).toEqual({});
				}
			}
		}
		expect(finalized).toHaveLength(1);
	});

	it("fails the replacement identity without restoring its accepted steer", async () => {
		let boundaryRead = false;
		const transitionCalls: Array<{
			nextAssistantMessageId: string;
			steerAcceptances: Array<{
				queuedMessageId: string;
				claimVersion: number;
				messageId: string;
			}>;
		}> = [];
		const activeStream = createActiveStreamSession({
			takeSteeredUserMessageGenerationBoundary: () => {
				if (boundaryRead) {
					return { consumed: [], pending: [] };
				}
				boundaryRead = true;
				return {
					consumed: [],
					pending: [
						{
							id: "user-b",
							role: "user",
							parts: [{ type: "text", text: "B" }],
						},
					],
					steerAcceptances: [
						{
							queuedMessageId: "queue-b",
							claimVersion: 3,
							messageId: "user-b",
						},
					],
				};
			},
			transitionGeneration: async (args) => {
				transitionCalls.push(args as (typeof transitionCalls)[number]);
			},
		});
		const failedRuns: unknown[] = [];
		let executionCount = 0;
		const result = await createHostedChatRunResponseStream({
			activeStreamSession: activeStream.session,
			agent: {},
			assistantMessageId: "assistant-a",
			assistantRunId: "run-1",
			chatMessages: [
				{
					id: "user-a",
					role: "user",
					parts: [{ type: "text", text: "A" }],
				},
			],
			createUiStream: async ({ onEnd }) => {
				executionCount += 1;
				if (executionCount === 2) {
					throw new Error("replacement setup failed");
				}
				onEnd({
					isAborted: false,
					responseMessage: {
						id: "assistant-a",
						role: "assistant",
						parts: [{ type: "text", text: "A response" }],
					},
				});
				return new ReadableStream({
					start: (controller) => controller.close(),
				});
			},
			failAssistantRun: async (args) => {
				failedRuns.push(args);
			},
			finalizeAssistantRun: async () => undefined,
			finalizedToolSet: { hasTools: false },
			instructions: "instructions",
			logLatency: () => undefined,
			streamLatencyTracker: createStreamLatencyTracker(),
		});

		if (!result.ok) {
			throw result.error;
		}
		await expect(
			(async () => {
				for await (const _chunk of result.responseStream) {
					// Consume until replacement setup fails.
				}
			})(),
		).rejects.toThrow("replacement setup failed");

		expect(transitionCalls).toHaveLength(1);
		expect(transitionCalls[0]?.steerAcceptances).toEqual([
			{
				queuedMessageId: "queue-b",
				claimVersion: 3,
				messageId: "user-b",
			},
		]);
		expect(failedRuns).toEqual([
			{
				runId: "run-1",
				assistantMessageId: transitionCalls[0]?.nextAssistantMessageId,
				errorText: "replacement setup failed",
			},
		]);
	});

	it("finalizes only the active assistant segment after an in-turn steer boundary", async () => {
		let boundaryRead = false;
		const activeStream = createActiveStreamSession({
			takeSteeredUserMessageGenerationBoundary: () => {
				if (boundaryRead) {
					return { consumed: [], pending: [] };
				}
				boundaryRead = true;
				return {
					consumed: [
						{
							input: [
								{
									id: "user-b",
									role: "user",
									parts: [{ type: "text", text: "B" }],
								},
							],
							stepNumber: 1,
						},
					],
					pending: [],
				};
			},
		});
		const finalized: unknown[] = [];
		const result = await createHostedChatRunResponseStream({
			activeStreamSession: activeStream.session,
			agent: {},
			assistantMessageId: "assistant-a",
			assistantRunId: "run-1",
			chatMessages: [],
			createUiStream: async ({ onEnd }) => {
				onEnd({
					isAborted: false,
					responseMessage: {
						id: "assistant-a",
						role: "assistant",
						parts: [
							{ type: "step-start" },
							{ type: "text", text: "A response" },
							{ type: "step-start" },
							{ type: "text", text: "B response" },
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
			finalizedToolSet: { hasTools: false },
			instructions: "instructions",
			logLatency: () => undefined,
			streamLatencyTracker: createStreamLatencyTracker(),
		});

		if (!result.ok) {
			throw result.error;
		}
		for await (const _chunk of result.responseStream) {
			// Consume the complete lifecycle.
		}
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(activeStream.generationTransitions).toHaveLength(1);
		expect(finalized).toEqual([
			{
				status: "completed",
				responseMessage: expect.objectContaining({
					parts: [{ type: "step-start" }, { type: "text", text: "B response" }],
				}),
			},
		]);
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
				assistantMessageId: "assistant-message-1",
			},
		]);
		expect(errors).toHaveLength(1);
	});

	it("contains run terminalization failure and still cleans up after stream creation fails", async () => {
		const activeStream = createActiveStreamSession();
		const terminalizationError = new Error("terminalization failed");
		const result = await createHostedChatRunResponseStream({
			activeStreamSession: activeStream.session,
			agent: {},
			assistantMessageId: "assistant-message-1",
			assistantRunId: "run-1",
			chatMessages: [],
			createUiStream: async () => {
				throw new Error("stream failed");
			},
			failAssistantRun: async () => {
				throw terminalizationError;
			},
			finalizeAssistantRun: async () => {
				throw new Error("run should not finalize");
			},
			finalizedToolSet: { hasTools: false },
			logLatency: () => undefined,
			streamLatencyTracker: createStreamLatencyTracker(),
			instructions: "instructions",
		});

		expect(result).toMatchObject({
			ok: false,
			terminalizationError,
		});
		expect(activeStream.cleanedUp).toBe(true);
		expect(activeStream.broadcastStarted).toBe(false);
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
					authority: undefined,
					consequence:
						"This action can change data or perform an external action.",
					toolCallId: "call-1",
					toolName: "delete_automation",
				},
				status: "waiting_for_user",
			}),
		]);
	});
});
