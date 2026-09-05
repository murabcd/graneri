import { act, renderHook } from "@testing-library/react";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { type FunctionReference, getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQueuedFollowUpControls } from "../src/hooks/use-queued-follow-up-controls";
import type { QueuedFollowUpMessage } from "../src/lib/chat-queued-followups";
import { createQueuedChatSession } from "../src/lib/queued-chat-session";

const convexMocks = vi.hoisted(() => ({
	discardQueued: vi.fn(),
	reorderQueuedForChat: vi.fn(),
	resumeInterruptedForChat: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useMutation: (reference: FunctionReference<"mutation">) => {
		switch (getFunctionName(reference)) {
			case "assistantQueuedMessages:discardQueued":
				return convexMocks.discardQueued;
			case "assistantQueuedMessages:reorderQueuedForChat":
				return convexMocks.reorderQueuedForChat;
			case "assistantQueuedMessages:resumeInterruptedForChat":
				return convexMocks.resumeInterruptedForChat;
			default:
				throw new Error("Unexpected Convex mutation");
		}
	},
}));

const workspaceId = "workspace-1" as Id<"workspaces">;
const runId = "run-1" as Id<"assistantRuns">;
let session = createQueuedChatSession("workspace-1:chat-1");

const createDeferredRejection = <T,>() => {
	let reject: (reason?: unknown) => void = () => {};
	const promise = new Promise<T>((_resolve, rejectPromise) => {
		reject = rejectPromise;
	});
	return { promise, reject };
};

const createQueuedMessage = (id: string): QueuedFollowUpMessage =>
	({
		_id: id as Id<"assistantQueuedMessages">,
		_creationTime: 1,
		chatId: "chat-doc-1" as Id<"chats">,
		createdAt: 1,
		messageId: `message-${id}`,
		ownerTokenIdentifier: "owner",
		requestBodyJson: JSON.stringify({
			...DEFAULT_CHAT_SETTINGS,
			localCapabilitySession: null,
			projectId: null,
			timezone: "UTC",
		}),
		runId,
		status: "queued",
		text: `Message ${id}`,
		updatedAt: 1,
		workspaceId,
	}) as QueuedFollowUpMessage;

const createQueuedMessagesHarness = (
	initialMessages: Array<QueuedFollowUpMessage>,
) => {
	const state = { messages: initialMessages };
	const setQueuedMessages = vi.fn(
		(
			updater: (messages: QueuedFollowUpMessage[]) => QueuedFollowUpMessage[],
		) => {
			state.messages = updater(state.messages);
		},
	);
	return { setQueuedMessages, state };
};

const renderQueuedMutationControls = ({
	setQueuedMessages,
	state,
}: ReturnType<typeof createQueuedMessagesHarness>) =>
	renderHook(() =>
		useQueuedFollowUpControls({
			session,
			activeRun: { _id: runId, status: "running" },
			chatId: "chat-1",
			contextLabel: "chat",
			followUpBehavior: "queue",
			isQueueHandoffPending: false,
			isUpdatingFollowUpBehavior: false,
			latestRequestBodyRef: { current: null },
			localMessageIds: new Set(),
			steerMessageIds: [],
			onEditMessage: vi.fn(),
			onFollowUpBehaviorChange: vi.fn(),
			queuedMessages: state.messages,
			sendMessage: vi.fn(),
			setQueuedMessages,
			workspaceId,
		}),
	);

describe("queued follow-up optimistic controls", () => {
	beforeEach(() => {
		convexMocks.discardQueued.mockReset().mockResolvedValue(null);
		convexMocks.reorderQueuedForChat.mockReset().mockResolvedValue(null);
		convexMocks.resumeInterruptedForChat.mockReset().mockResolvedValue(null);
		session = createQueuedChatSession("workspace-1:chat-1");
	});

	it("restores a failed optimistic deletion at its exact position", async () => {
		const first = createQueuedMessage("queued-1");
		const second = createQueuedMessage("queued-2");
		const third = createQueuedMessage("queued-3");
		const harness = createQueuedMessagesHarness([first, second, third]);
		const deletion = createDeferredRejection<null>();
		convexMocks.discardQueued.mockReturnValueOnce(deletion.promise);
		const { result } = renderQueuedMutationControls(harness);

		act(() => result.current.queuedFollowUps[1]?.onDelete());

		expect(harness.state.messages).toEqual([first, third]);
		expect(convexMocks.discardQueued).toHaveBeenCalledWith({
			workspaceId,
			chatId: "chat-1",
			queuedMessageId: second._id,
		});

		await act(async () => {
			deletion.reject(new Error("delete failed"));
			await deletion.promise.catch(() => undefined);
		});
		expect(harness.state.messages).toEqual([first, second, third]);
	});

	it("rolls back only the latest failed optimistic reorder", async () => {
		const first = createQueuedMessage("queued-1");
		const second = createQueuedMessage("queued-2");
		const third = createQueuedMessage("queued-3");
		const harness = createQueuedMessagesHarness([first, second, third]);
		const firstReorder = createDeferredRejection<null>();
		const secondReorder = createDeferredRejection<null>();
		convexMocks.reorderQueuedForChat
			.mockReturnValueOnce(firstReorder.promise)
			.mockReturnValueOnce(secondReorder.promise);
		const { rerender, result } = renderQueuedMutationControls(harness);

		act(() =>
			result.current.onQueuedFollowUpsReorder([
				"queued-1",
				"queued-1",
				"queued-3",
			]),
		);
		expect(harness.state.messages).toEqual([first, second, third]);
		expect(convexMocks.reorderQueuedForChat).not.toHaveBeenCalled();

		act(() =>
			result.current.onQueuedFollowUpsReorder([
				"queued-3",
				"queued-1",
				"queued-2",
			]),
		);
		expect(harness.state.messages).toEqual([third, first, second]);
		rerender();

		act(() =>
			result.current.onQueuedFollowUpsReorder([
				"queued-2",
				"queued-3",
				"queued-1",
			]),
		);
		expect(harness.state.messages).toEqual([second, third, first]);

		await act(async () => {
			firstReorder.reject(new Error("stale reorder failed"));
			await firstReorder.promise.catch(() => undefined);
		});
		expect(harness.state.messages).toEqual([second, third, first]);

		await act(async () => {
			secondReorder.reject(new Error("latest reorder failed"));
			await secondReorder.promise.catch(() => undefined);
		});
		expect(harness.state.messages).toEqual([third, first, second]);
	});
});
