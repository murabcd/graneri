import { describe, expect, it } from "vitest";
import {
	consumeHostedAssistantExecutionStream,
	getHostedAssistantExecutionOutcome,
	validateHostedAssistantMessages,
} from "../src/hosted-chat-execution.mjs";

describe("hosted assistant execution", () => {
	it("returns the SDK-validated messages", async () => {
		const messages = [
			{
				id: "user-1",
				role: "user" as const,
				parts: [{ type: "text" as const, text: "Hello" }],
			},
		];

		await expect(
			validateHostedAssistantMessages({ messages }),
		).resolves.toEqual(messages);
	});

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
		const stream = new ReadableStream({
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
		const latest = await consumeHostedAssistantExecutionStream({
			stream,
			onMessage: (message) => seen.push(message),
		});
		expect(seen).toHaveLength(3);
		expect(latest).toMatchObject({
			role: "assistant",
			parts: [{ type: "text", text: "Hello", state: "done" }],
		});
	});
});
