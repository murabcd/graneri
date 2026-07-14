import { describe, expect, it } from "vitest";
import {
	getHostedAssistantExecutionOutcome,
	startHostedAssistantExecution,
} from "../src/hosted-chat-execution.mjs";

const createTextStream = () =>
	new ReadableStream({
		start(controller) {
			controller.enqueue({ type: "text-start", id: "text-1" });
			controller.enqueue({
				type: "text-delta",
				id: "text-1",
				delta: "Hello",
			});
			controller.enqueue({ type: "text-end", id: "text-1" });
			controller.close();
		},
	});

describe("hosted assistant execution", () => {
	it("classifies completion and approval outcomes", () => {
		const completedMessage = {
			id: "assistant-1",
			role: "assistant" as const,
			parts: [{ type: "text" as const, text: "Done" }],
		};
		expect(
			getHostedAssistantExecutionOutcome({
				isAborted: false,
				responseMessage: completedMessage,
			}),
		).toEqual({ responseMessage: completedMessage, status: "completed" });

		const approvalMessage = {
			id: "assistant-2",
			role: "assistant" as const,
			parts: [
				{
					type: "tool-delete_note" as const,
					state: "approval-requested" as const,
					toolCallId: "call-1",
					input: { noteId: "note-1" },
					approval: { id: "approval-1" },
				},
			],
		};
		expect(
			getHostedAssistantExecutionOutcome({
				isAborted: false,
				responseMessage: approvalMessage,
			}),
		).toMatchObject({
			status: "waiting_for_user",
			pendingDecision: {
				approvalId: "approval-1",
				assistantMessageId: "assistant-2",
				toolCallId: "call-1",
				toolName: "delete_note",
			},
		});
	});

	it("consumes rich message snapshots and returns the final snapshot", async () => {
		const seen: unknown[] = [];
		const result = await startHostedAssistantExecution({
			agent: {} as never,
			assistantMessageId: "assistant-1",
			messages: [],
			createUiStream: async () => createTextStream(),
			delivery: {
				mode: "consume",
				onMessage: (message) => seen.push(message),
			},
		});
		expect(seen).toHaveLength(3);
		expect(result.outcome).toMatchObject({
			status: "completed",
			responseMessage: {
				role: "assistant",
				parts: [{ type: "text", text: "Hello", state: "done" }],
			},
		});
	});

	it("streams and observes the same execution without exposing lifecycle primitives", async () => {
		const seen: unknown[] = [];
		const responseMessage = {
			id: "assistant-1",
			role: "assistant" as const,
			parts: [{ type: "text" as const, text: "Hello" }],
		};
		const result = await startHostedAssistantExecution({
			agent: {} as never,
			assistantMessageId: "assistant-1",
			messages: [],
			createUiStream: async ({ onFinish }) => {
				onFinish({ isAborted: false, responseMessage });
				return createTextStream();
			},
			delivery: {
				mode: "stream",
				onMessage: (message) => seen.push(message),
			},
		});

		const chunks = [];
		for await (const chunk of result.stream) {
			chunks.push(chunk);
		}

		await expect(result.completion).resolves.toEqual({
			status: "completed",
			responseMessage,
		});
		expect(seen).toHaveLength(3);
		expect(chunks).toHaveLength(3);
	});

	it("fails closed when the SDK produces no finish result or message", async () => {
		await expect(
			startHostedAssistantExecution({
				agent: {} as never,
				assistantMessageId: "assistant-1",
				messages: [],
				createUiStream: async () =>
					new ReadableStream({
						start: (controller) => controller.close(),
					}),
				delivery: { mode: "consume" },
			}),
		).rejects.toThrow(
			"Assistant execution completed without a response message.",
		);
	});
});
