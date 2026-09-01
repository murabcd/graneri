import { createHostedActiveChatStreamSession } from "@workspace/ai/hosted-chat-runtime";
import type { HostedActiveStreamSession } from "@workspace/ai/hosted-chat-turn";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel.js";
import { interruptHostedChatRun } from "../server/chat-turn-stream-runtime.js";

describe("hosted chat turn stream runtime", () => {
	it("stops a consumed steer with a split durable boundary and defers mailbox input", async () => {
		const runId = "run-1" as Id<"assistantRuns">;
		const workspaceId = "workspace-1" as Id<"workspaces">;
		const queuedMessageId = "queue-b" as Id<"assistantQueuedMessages">;
		const controllers = new Map<
			string,
			HostedActiveStreamSession<
				Id<"assistantRuns">,
				Id<"assistantQueuedMessages">
			>
		>();
		const session = createHostedActiveChatStreamSession({
			callbacks: {
				finishActiveStream: vi.fn().mockResolvedValue(null),
				finishActiveStreamToolCall: vi.fn().mockResolvedValue(null),
				startActiveStream: vi.fn().mockResolvedValue(null),
				startActiveStreamToolCall: vi.fn().mockResolvedValue(null),
				transitionActiveStreamGeneration: vi.fn().mockResolvedValue(null),
				updateActiveStream: vi.fn().mockResolvedValue(null),
			},
			chatId: "chat-1",
			controllers,
			messageId: "assistant-a",
			runId,
			workspaceId,
		});
		await session.start();
		const steerMessage = {
			id: "user-b",
			role: "user" as const,
			parts: [{ type: "text" as const, text: "B" }],
		};
		session.acceptSteeredUserMessage(steerMessage, {
			queuedMessageId,
			claimVersion: 2,
			messageId: steerMessage.id,
		});
		expect(session.takePendingSteeredUserMessages(1)).toEqual([steerMessage]);
		const mailboxMessage = {
			id: "mailbox-c",
			role: "user" as const,
			parts: [{ type: "text" as const, text: "C" }],
		};
		session.turnInput.enqueueMailboxInput(mailboxMessage);
		session.replaceParts([
			{ type: "step-start" },
			{ type: "text", text: "A response" },
			{ type: "step-start" },
			{ type: "text", text: "B response" },
		]);
		const stopActiveStream = vi
			.fn()
			.mockRejectedValueOnce(new Error("durable stop unavailable"))
			.mockResolvedValueOnce(null);

		const stop = () =>
			interruptHostedChatRun({
				activeStreamSessions: controllers,
				assistantMessageId: "assistant-a",
				chatId: "chat-1",
				runId,
				stopActiveStream,
				workspaceId,
			});

		await expect(stop()).rejects.toThrow("durable stop unavailable");
		expect(controllers.get(session.streamKey)).toBe(session);
		const deferredInput = await stop();

		expect(deferredInput).toEqual([mailboxMessage]);
		expect(stopActiveStream).toHaveBeenCalledTimes(2);
		expect(stopActiveStream).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				steeredGenerationBoundary: {
					orderedMessageIds: [
						"assistant-a",
						"user-b",
						expect.stringMatching(/^stream-/),
					],
					steerAcceptances: [
						{
							queuedMessageId,
							claimVersion: 2,
							messageId: "user-b",
						},
					],
					assistantMessages: [
						expect.objectContaining({
							id: "assistant-a",
							role: "assistant",
							text: "A response",
						}),
						expect.objectContaining({
							id: expect.stringMatching(/^stream-/),
							role: "assistant",
							text: "B response",
						}),
					],
				},
			}),
		);
		expect(stopActiveStream.mock.calls[1]?.[0]).toEqual(
			stopActiveStream.mock.calls[0]?.[0],
		);
		expect(controllers.has(session.streamKey)).toBe(false);
	});
});
