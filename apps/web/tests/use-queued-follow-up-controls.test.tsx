import { act, renderHook } from "@testing-library/react";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQueuedFollowUpControls } from "../src/hooks/use-queued-follow-up-controls";
import type { QueuedFollowUpMessage } from "../src/lib/chat-queued-followups";
import { createQueuedChatSession } from "../src/lib/queued-chat-session";

const tokenMocks = vi.hoisted(() => ({
	getCachedConvexToken: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useMutation: () => vi.fn(),
}));

vi.mock("../src/lib/convex-token", () => ({
	getCachedConvexToken: tokenMocks.getCachedConvexToken,
}));

const workspaceId = "workspace-1" as Id<"workspaces">;
const runId = "run-1" as Id<"assistantRuns">;
const session = createQueuedChatSession("workspace-1:chat-1");

const createQueuedMessage = ({
	id = "queued-1",
	messageId = "queued-message-1",
	pauseReason = "failed",
	status = "queued",
	text = "Steer now",
}: {
	id?: string;
	messageId?: string;
	pauseReason?: "failed" | "interrupted";
	status?: QueuedFollowUpMessage["status"];
	text?: string;
} = {}): QueuedFollowUpMessage =>
	({
		_id: id as Id<"assistantQueuedMessages">,
		_creationTime: 1,
		chatId: "chat-doc-1" as Id<"chats">,
		createdAt: 1,
		messageId,
		ownerTokenIdentifier: "owner",
		requestBodyJson: JSON.stringify({
			...DEFAULT_CHAT_SETTINGS,
			localCapabilitySession: null,
			projectId: null,
			timezone: "UTC",
		}),
		runId,
		status,
		...(status === "paused" && { pauseReason }),
		text,
		updatedAt: 1,
		workspaceId,
	}) as QueuedFollowUpMessage;

describe("queued edit ownership", () => {
	it("does not let an older queued edit completion clear a newer edit", () => {
		const firstQueuedMessage = createQueuedMessage({
			id: "queued-1",
			messageId: "queued-message-1",
			text: "First edit",
		});
		const secondQueuedMessage = createQueuedMessage({
			id: "queued-2",
			messageId: "queued-message-2",
			text: "Second edit",
		});
		let queuedMessages = [firstQueuedMessage, secondQueuedMessage];
		const setQueuedMessages = vi.fn(
			(
				updater: (messages: QueuedFollowUpMessage[]) => QueuedFollowUpMessage[],
			) => {
				queuedMessages = updater(queuedMessages);
			},
		);

		const { result } = renderHook(() =>
			useQueuedFollowUpControls({
				session,
				followUpBehavior: "queue",
				isQueueHandoffPending: false,
				isUpdatingFollowUpBehavior: false,
				onFollowUpBehaviorChange: vi.fn(),
				activeRun: { _id: runId, status: "running" },
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				steerMessageIds: [],
				onEditMessage: vi.fn(),
				queuedMessages,
				sendMessage: vi.fn(),
				setQueuedMessages,
				workspaceId,
			}),
		);

		act(() => {
			result.current.queuedFollowUps[0]?.onEdit();
		});
		const finishFirstEdit = result.current.finishQueuedMessageEdit;

		act(() => {
			result.current.queuedFollowUps[0]?.onEdit();
		});

		const updatedFirstMessage = {
			...firstQueuedMessage,
			text: "Updated first edit",
		};
		let didFinishFirstEdit = true;
		act(() => {
			didFinishFirstEdit = finishFirstEdit(updatedFirstMessage);
		});

		expect(didFinishFirstEdit).toBe(false);
		expect(result.current.editDraft?.message._id).toBe(secondQueuedMessage._id);
		expect(queuedMessages).toEqual([updatedFirstMessage]);
	});
});
