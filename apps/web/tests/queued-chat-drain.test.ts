import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { drainQueuedChatMessage } from "../src/lib/queued-chat-intent";

const workspaceId = "workspace-1" as Id<"workspaces">;
const queuedMessageId = "queued-1" as Id<"assistantQueuedMessages">;

const createQueuedMessage = () => ({
	_id: queuedMessageId,
	_creationTime: 1,
	chatId: "chat-1" as Id<"chats">,
	createdAt: 1,
	messageId: "queued-message-1",
	ownerTokenIdentifier: "owner",
	requestBodyJson: JSON.stringify({
		...DEFAULT_CHAT_SETTINGS,
		localCapabilitySession: null,
		projectId: null,
		timezone: "UTC",
	}),
	runId: "run-1" as Id<"assistantRuns">,
	status: "queued" as const,
	text: "Queued",
	updatedAt: 1,
	workspaceId,
});

const createDrainArgs = (
	overrides: Partial<Parameters<typeof drainQueuedChatMessage>[0]> = {},
) => ({
	beginReplay: vi.fn(() => vi.fn()),
	hasMessageId: vi.fn().mockReturnValue(false),
	queuedMessage: createQueuedMessage(),
	resolveConvexToken: vi.fn().mockResolvedValue("fresh-token"),
	sendMessage: vi.fn().mockResolvedValue(null),
	setLatestRequestBody: vi.fn(),
	...overrides,
});

describe("queued chat drain", () => {
	it("waits for a Convex token without changing the visible queued row", async () => {
		const queuedMessage = createQueuedMessage();
		const args = createDrainArgs({
			queuedMessage,
			resolveConvexToken: vi.fn().mockResolvedValue(null),
		});

		await expect(drainQueuedChatMessage(args)).resolves.toEqual({
			status: "retry",
		});
		expect(args.sendMessage).not.toHaveBeenCalled();
		expect(args.queuedMessage).toBe(queuedMessage);
	});

	it("sends a visible queued row for server-owned claiming", async () => {
		const lifecycleEvents: string[] = [];
		const finishReplay = vi.fn(() => lifecycleEvents.push("finish"));
		const args = createDrainArgs({
			beginReplay: vi.fn(() => {
				lifecycleEvents.push("begin");
				return finishReplay;
			}),
			sendMessage: vi.fn(async () => {
				lifecycleEvents.push("send");
			}),
		});

		await expect(drainQueuedChatMessage(args)).resolves.toEqual({
			status: "sent",
		});
		expect(args.setLatestRequestBody).toHaveBeenCalledWith({
			...DEFAULT_CHAT_SETTINGS,
			convexToken: "fresh-token",
			localCapabilitySession: null,
			projectId: null,
			replayQueuedMessageId: queuedMessageId,
			replayQueuedMessageOrigin: "automatic",
			replayQueuedMessageStatus: "queued",
			timezone: "UTC",
			workspaceId,
		});
		expect(args.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ text: "Queued" }),
			{
				body: {
					...DEFAULT_CHAT_SETTINGS,
					convexToken: "fresh-token",
					localCapabilitySession: null,
					projectId: null,
					replayQueuedMessageId: queuedMessageId,
					replayQueuedMessageOrigin: "automatic",
					replayQueuedMessageStatus: "queued",
					timezone: "UTC",
					workspaceId,
				},
			},
		);
		expect(args.beginReplay).toHaveBeenCalledWith(args.queuedMessage);
		expect(finishReplay).toHaveBeenCalledOnce();
		expect(lifecycleEvents).toEqual(["begin", "send", "finish"]);
	});

	it("is idle when no queued row is visible", async () => {
		const args = createDrainArgs({ queuedMessage: null });

		await expect(drainQueuedChatMessage(args)).resolves.toEqual({
			status: "idle",
		});
		expect(args.sendMessage).not.toHaveBeenCalled();
	});

	it("keeps the queued row available when submission rejects", async () => {
		const queuedMessage = createQueuedMessage();
		const sendError = new Error("send failed");
		const finishReplay = vi.fn();
		const args = createDrainArgs({
			beginReplay: vi.fn(() => finishReplay),
			queuedMessage,
			sendMessage: vi.fn().mockRejectedValue(sendError),
		});

		await expect(drainQueuedChatMessage(args)).resolves.toEqual({
			error: sendError,
			status: "send_failed",
		});
		expect(args.queuedMessage).toBe(queuedMessage);
		expect(finishReplay).toHaveBeenCalledOnce();
	});
});
