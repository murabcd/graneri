import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { describe, expect, it } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { QueuedFollowUpMessage } from "../src/lib/chat-queued-followups";
import {
	prepareQueuedReplayIntent,
	prepareQueuedSteerIntent,
} from "../src/lib/queued-chat-intent";

const workspaceId = "workspace-1" as Id<"workspaces">;
const runId = "run-1" as Id<"assistantRuns">;
const queuedMessageId = "queued-1" as Id<"assistantQueuedMessages">;

const createQueuedMessage = (
	status: QueuedFollowUpMessage["status"] = "queued",
): QueuedFollowUpMessage => ({
	_id: queuedMessageId,
	_creationTime: 1,
	chatId: "chat-1",
	createdAt: 1,
	messageId: "queued-message-1",
	ownerTokenIdentifier: "owner",
	filesJson: "[]",
	requestBodyJson: JSON.stringify({
		...DEFAULT_CHAT_SETTINGS,
		localCapabilitySession: null,
		projectId: null,
		timezone: "UTC",
	}),
	runId,
	status,
	text: "Queued",
	updatedAt: 1,
	workspaceId,
});

describe("queued chat intent", () => {
	it("prepares replay intent with the durable replay id", async () => {
		await expect(
			prepareQueuedReplayIntent({
				hasMessageId: () => false,
				origin: "manual",
				queuedMessage: createQueuedMessage(),
				resolveConvexToken: async () => "fresh-token",
			}),
		).resolves.toMatchObject({
			body: {
				...DEFAULT_CHAT_SETTINGS,
				convexToken: "fresh-token",
				localCapabilitySession: null,
				projectId: null,
				replayQueuedMessageId: queuedMessageId,
				replayQueuedMessageOrigin: "manual",
				replayQueuedMessageStatus: "queued",
				workspaceId,
			},
			message: {
				text: "Queued",
			},
		});
	});

	it("prepares steer intent without leaking replay fields", async () => {
		await expect(
			prepareQueuedSteerIntent({
				activeRunId: runId,
				hasMessageId: () => false,
				queuedMessage: createQueuedMessage(),
				resolveConvexToken: async () => "fresh-token",
			}),
		).resolves.toMatchObject({
			body: {
				...DEFAULT_CHAT_SETTINGS,
				convexToken: "fresh-token",
				continueRunId: runId,
				localCapabilitySession: null,
				projectId: null,
				steerQueuedMessageId: queuedMessageId,
				workspaceId,
			},
			message: {
				text: "Queued",
			},
		});

		const prepared = await prepareQueuedSteerIntent({
			activeRunId: runId,
			hasMessageId: () => false,
			queuedMessage: createQueuedMessage(),
			resolveConvexToken: async () => "fresh-token",
		});
		expect(prepared.body).not.toHaveProperty("replayQueuedMessageId");
		expect(prepared.body).not.toHaveProperty("replayQueuedMessageOrigin");
		expect(prepared.body).not.toHaveProperty("replayQueuedMessageStatus");
	});
});
