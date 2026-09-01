import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import {
	AbstractChat,
	type ChatState,
	type ChatTransport,
	type UIMessage,
} from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQueuedChatDrain } from "../src/hooks/use-queued-chat-drain";
import { resetQueuedFollowUpsCacheForTest } from "../src/lib/chat-queued-followups";

const convexMocks = vi.hoisted(() => ({
	listQueuedForChat: [] as unknown,
}));

const tokenMocks = vi.hoisted(() => ({
	getCachedConvexToken: vi.fn(),
}));
const acceptedQueuedMessageIdsRef = { current: new Set<string>() };

vi.mock("convex/react", () => ({
	useQuery: () => convexMocks.listQueuedForChat,
}));

vi.mock("../src/lib/convex-token", () => ({
	getCachedConvexToken: tokenMocks.getCachedConvexToken,
}));

const createQueuedMessage = ({
	pauseReason = "failed",
	status = "queued",
}: {
	pauseReason?: "failed" | "interrupted";
	status?: "paused" | "queued";
} = {}) => ({
	_id: "queued-1" as Id<"assistantQueuedMessages">,
	_creationTime: 1,
	chatId: "chat-doc-1" as Id<"chats">,
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
	status,
	...(status === "paused" && { pauseReason }),
	text: "Queued",
	updatedAt: 1,
	workspaceId: "workspace-1" as Id<"workspaces">,
});

const createFailingAiSdkChat = () => {
	const state: ChatState<UIMessage> = {
		error: undefined,
		messages: [],
		popMessage: () => {
			state.messages.pop();
		},
		pushMessage: (message) => {
			state.messages.push(message);
		},
		replaceMessage: (index, message) => {
			state.messages[index] = message;
		},
		snapshot: (value) => value,
		status: "ready",
	};
	const transport: ChatTransport<UIMessage> = {
		reconnectToStream: async () => null,
		sendMessages: async () => {
			throw new TypeError("fetch failed");
		},
	};

	return new (class extends AbstractChat<UIMessage> {})({ state, transport });
};

describe("useQueuedChatDrain", () => {
	beforeEach(() => {
		acceptedQueuedMessageIdsRef.current.clear();
		tokenMocks.getCachedConvexToken.mockReset();
		resetQueuedFollowUpsCacheForTest();
		convexMocks.listQueuedForChat = [createQueuedMessage()];
	});

	afterEach(() => {
		cleanup();
		resetQueuedFollowUpsCacheForTest();
	});

	it("waits for a Convex token without claiming or hiding the queued row", async () => {
		tokenMocks.getCachedConvexToken.mockResolvedValue(null);
		const sendMessage = vi.fn();

		const { result } = renderHook(() =>
			useQueuedChatDrain({
				acceptedQueuedMessageId: null,
				acceptedQueuedMessageIdsRef,
				activeRun: null,
				chatId: "chat-1",
				contextLabel: "chat",
				isBlocked: false,
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				sendMessage,
				workspaceId: "workspace-1" as Id<"workspaces">,
			}),
		);

		await waitFor(() => {
			expect(tokenMocks.getCachedConvexToken).toHaveBeenCalled();
		});
		expect(sendMessage).not.toHaveBeenCalled();
		expect(result.current.queuedMessages).toHaveLength(1);
	});

	it("sends the visible row for server-owned claiming", async () => {
		const sendMessage = vi.fn().mockResolvedValue(undefined);
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");

		const { result } = renderHook(() =>
			useQueuedChatDrain({
				acceptedQueuedMessageId: null,
				acceptedQueuedMessageIdsRef,
				activeRun: null,
				chatId: "chat-1",
				contextLabel: "chat",
				isBlocked: false,
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				sendMessage,
				workspaceId: "workspace-1" as Id<"workspaces">,
			}),
		);

		await waitFor(() => {
			expect(sendMessage).toHaveBeenCalled();
		});
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ text: "Queued" }),
			{
				body: {
					...DEFAULT_CHAT_SETTINGS,
					convexToken: "fresh-token",
					localCapabilitySession: null,
					projectId: null,
					replayQueuedMessageId: "queued-1",
					replayQueuedMessageOrigin: "automatic",
					replayQueuedMessageStatus: "queued",
					timezone: "UTC",
					workspaceId: "workspace-1",
				},
			},
		);
		expect(result.current.queuedMessages).toHaveLength(1);
	});

	it("drains the first queued row after natural completion", async () => {
		convexMocks.listQueuedForChat = [
			createQueuedMessage(),
			{
				...createQueuedMessage(),
				_id: "queued-2" as Id<"assistantQueuedMessages">,
				createdAt: 2,
				messageId: "queued-message-2",
				text: "Second queued message",
				updatedAt: 2,
			},
		];
		const sendMessage = vi.fn().mockResolvedValue(undefined);
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");

		renderHook(() =>
			useQueuedChatDrain({
				acceptedQueuedMessageId: null,
				acceptedQueuedMessageIdsRef,
				activeRun: null,
				chatId: "chat-1",
				contextLabel: "chat",
				isBlocked: false,
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				sendMessage,
				workspaceId: "workspace-1" as Id<"workspaces">,
			}),
		);

		await waitFor(() => {
			expect(sendMessage).toHaveBeenCalled();
		});
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ text: "Queued" }),
			expect.objectContaining({
				body: expect.objectContaining({ replayQueuedMessageId: "queued-1" }),
			}),
		);
	});

	it("drains three queued rows FIFO across natural completions", async () => {
		const rows = [
			createQueuedMessage(),
			{
				...createQueuedMessage(),
				_id: "queued-2" as Id<"assistantQueuedMessages">,
				createdAt: 2,
				messageId: "queued-message-2",
				text: "Second queued message",
				updatedAt: 2,
			},
			{
				...createQueuedMessage(),
				_id: "queued-3" as Id<"assistantQueuedMessages">,
				createdAt: 3,
				messageId: "queued-message-3",
				text: "Third queued message",
				updatedAt: 3,
			},
		];
		convexMocks.listQueuedForChat = rows;
		const sendMessage = vi.fn().mockResolvedValue(undefined);
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");
		let activeRun: { _id: string; status: "running" } | null = null;
		const { rerender } = renderHook(() =>
			useQueuedChatDrain({
				acceptedQueuedMessageId: null,
				acceptedQueuedMessageIdsRef,
				activeRun,
				chatId: "chat-1",
				contextLabel: "chat",
				isBlocked: false,
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				sendMessage,
				workspaceId: "workspace-1" as Id<"workspaces">,
			}),
		);

		await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
		expect(sendMessage.mock.calls[0]?.[1].body.replayQueuedMessageId).toBe(
			"queued-1",
		);
		activeRun = { _id: "run-1", status: "running" };
		convexMocks.listQueuedForChat = rows.slice(1);
		rerender();
		expect(sendMessage).toHaveBeenCalledTimes(1);

		activeRun = null;
		rerender();
		await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
		expect(sendMessage.mock.calls[1]?.[1].body.replayQueuedMessageId).toBe(
			"queued-2",
		);
		activeRun = { _id: "run-2", status: "running" };
		convexMocks.listQueuedForChat = rows.slice(2);
		rerender();
		expect(sendMessage).toHaveBeenCalledTimes(2);

		activeRun = null;
		rerender();
		await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
		expect(sendMessage.mock.calls[2]?.[1].body.replayQueuedMessageId).toBe(
			"queued-3",
		);
	});

	it("keeps the durable row visible when AI SDK swallows a transport error", async () => {
		const chat = createFailingAiSdkChat();
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");

		const { result } = renderHook(() =>
			useQueuedChatDrain({
				acceptedQueuedMessageId: null,
				acceptedQueuedMessageIdsRef,
				activeRun: null,
				chatId: "chat-1",
				contextLabel: "chat",
				isBlocked: false,
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				sendMessage: chat.sendMessage,
				workspaceId: "workspace-1" as Id<"workspaces">,
			}),
		);

		await waitFor(() => {
			expect(chat.status).toBe("error");
		});
		expect(chat.error).toMatchObject({ message: "fetch failed" });
		expect(result.current.queuedMessages[0]?._id).toBe("queued-1");
	});

	it("does not automatically drain paused rows", async () => {
		convexMocks.listQueuedForChat = [createQueuedMessage({ status: "paused" })];
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");
		const sendMessage = vi.fn();

		const { result } = renderHook(() =>
			useQueuedChatDrain({
				acceptedQueuedMessageId: null,
				acceptedQueuedMessageIdsRef,
				activeRun: null,
				chatId: "chat-1",
				contextLabel: "chat",
				isBlocked: false,
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				sendMessage,
				workspaceId: "workspace-1" as Id<"workspaces">,
			}),
		);

		await waitFor(() => {
			expect(result.current.queuedMessages[0]?.status).toBe("paused");
		});
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("does not automatically drain while the current run is stopping", async () => {
		const sendMessage = vi.fn();
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");

		renderHook(() =>
			useQueuedChatDrain({
				acceptedQueuedMessageId: null,
				acceptedQueuedMessageIdsRef,
				activeRun: {
					_id: "run-stopping" as Id<"assistantRuns">,
					status: "stopping",
				},
				chatId: "chat-1",
				contextLabel: "chat",
				isBlocked: false,
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				sendMessage,
				workspaceId: "workspace-1" as Id<"workspaces">,
			}),
		);

		await waitFor(() => expect(sendMessage).not.toHaveBeenCalled());
	});

	it("does not skip a failed queue head to drain a later queued row", async () => {
		convexMocks.listQueuedForChat = [
			createQueuedMessage({ status: "paused" }),
			{
				...createQueuedMessage(),
				_id: "queued-2" as Id<"assistantQueuedMessages">,
				createdAt: 2,
				messageId: "queued-message-2",
				text: "Later queued message",
				updatedAt: 2,
			},
		];
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");
		const sendMessage = vi.fn();

		renderHook(() =>
			useQueuedChatDrain({
				acceptedQueuedMessageId: null,
				acceptedQueuedMessageIdsRef,
				activeRun: null,
				chatId: "chat-1",
				contextLabel: "chat",
				isBlocked: false,
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				sendMessage,
				workspaceId: "workspace-1" as Id<"workspaces">,
			}),
		);

		await waitFor(() => {
			expect(sendMessage).not.toHaveBeenCalled();
		});
	});

	it("hides an accepted stale row and does not replay while its continuation runs", async () => {
		const acceptedMessage = createQueuedMessage();
		const nextMessage = {
			...createQueuedMessage(),
			_id: "queued-2" as Id<"assistantQueuedMessages">,
			createdAt: 2,
			messageId: "queued-message-2",
			text: "Next queued message",
			updatedAt: 2,
		};
		convexMocks.listQueuedForChat = [acceptedMessage, nextMessage];
		acceptedQueuedMessageIdsRef.current.add(acceptedMessage._id);
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");
		const sendMessage = vi.fn().mockResolvedValue(undefined);
		let activeRun: { _id: Id<"assistantRuns">; status: "running" } | null = {
			_id: "run-1" as Id<"assistantRuns">,
			status: "running",
		};

		const { result, rerender } = renderHook(() =>
			useQueuedChatDrain({
				acceptedQueuedMessageId: acceptedMessage._id,
				acceptedQueuedMessageIdsRef,
				activeRun,
				chatId: "chat-1",
				contextLabel: "chat",
				isBlocked: false,
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				sendMessage,
				workspaceId: "workspace-1" as Id<"workspaces">,
			}),
		);

		await waitFor(() => {
			expect(
				result.current.queuedMessages.map((message) => message._id),
			).toEqual(["queued-2"]);
		});
		expect(sendMessage).not.toHaveBeenCalled();

		convexMocks.listQueuedForChat = [nextMessage];
		activeRun = null;
		rerender();

		await waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
		expect(sendMessage.mock.calls[0]?.[1].body.replayQueuedMessageId).toBe(
			"queued-2",
		);
	});
});
