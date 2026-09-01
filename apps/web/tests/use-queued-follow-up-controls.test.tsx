import { act, renderHook, waitFor } from "@testing-library/react";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQueuedFollowUpControls } from "../src/hooks/use-queued-follow-up-controls";
import type { AttachableAssistantRunQueryResult } from "../src/lib/attachable-assistant-run";
import type { QueuedFollowUpMessage } from "../src/lib/chat-queued-followups";
import type { ChatRequestContext } from "../src/lib/chat-request-preparation";
import { resolveRendererQueueActiveRun } from "../src/lib/renderer-chat-session";

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
const acceptedQueuedMessageIdsRef = { current: new Set<string>() };
const manuallySendingQueuedMessageIdRef = { current: null as string | null };

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

describe("useQueuedFollowUpControls", () => {
	beforeEach(() => {
		tokenMocks.getCachedConvexToken.mockReset();
		acceptedQueuedMessageIdsRef.current.clear();
		manuallySendingQueuedMessageIdRef.current = null;
	});

	it("rolls back handoff state while keeping the server-owned row visible", async () => {
		const queuedMessage = createQueuedMessage();
		let queuedMessages = [queuedMessage];
		const setQueuedMessages = vi.fn(
			(
				updater: (messages: QueuedFollowUpMessage[]) => QueuedFollowUpMessage[],
			) => {
				queuedMessages = updater(queuedMessages);
			},
		);
		const rollbackHandoff = vi.fn();
		const onSteerStart = vi.fn(() => rollbackHandoff);
		const sendMessage = vi.fn().mockRejectedValue(new Error("send failed"));
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");
		const latestRequestBodyRef = {
			current: null as ChatRequestContext | null,
		};

		const { result } = renderHook(() =>
			useQueuedFollowUpControls({
				acceptedQueuedMessageIdsRef,
				acceptedQueuedMessageId: null,
				activeRun: { _id: runId, status: "running" },
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef,
				localMessageIds: new Set(),
				manuallySendingQueuedMessageIdRef,
				onEditMessage: vi.fn(),
				onSteerStart,
				queuedMessages,
				sendMessage,
				setQueuedMessages,
				workspaceId,
			}),
		);

		await act(async () => {
			await result.current.sendQueuedFollowUpNow("queued-1");
		});

		expect(onSteerStart).toHaveBeenCalledOnce();
		expect(rollbackHandoff).toHaveBeenCalledOnce();
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ text: "Steer now" }),
			{
				body: {
					...DEFAULT_CHAT_SETTINGS,
					convexToken: "fresh-token",
					continueRunId: runId,
					localCapabilitySession: null,
					projectId: null,
					steerQueuedMessageId: "queued-1",
					timezone: "UTC",
					workspaceId,
				},
			},
		);
		expect(queuedMessages).toEqual([queuedMessage]);
	});

	it("keeps an accepted handoff when the response body fails before React rerenders", async () => {
		const queuedMessage = createQueuedMessage();
		const rollbackHandoff = vi.fn();
		const sendMessage = vi.fn(async () => {
			acceptedQueuedMessageIdsRef.current.add(queuedMessage._id);
			manuallySendingQueuedMessageIdRef.current = null;
			throw new Error("accepted stream failed");
		});
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");

		const { result } = renderHook(() =>
			useQueuedFollowUpControls({
				acceptedQueuedMessageIdsRef,
				acceptedQueuedMessageId: null,
				activeRun: { _id: runId, status: "running" },
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				manuallySendingQueuedMessageIdRef,
				onEditMessage: vi.fn(),
				onSteerStart: () => rollbackHandoff,
				queuedMessages: [queuedMessage],
				sendMessage,
				setQueuedMessages: vi.fn(),
				workspaceId,
			}),
		);

		await act(async () => {
			await result.current.sendQueuedFollowUpNow(queuedMessage._id);
		});

		expect(rollbackHandoff).not.toHaveBeenCalled();
		expect(sendMessage).toHaveBeenCalledOnce();
	});

	it("does not start handoff when queued request preparation fails", async () => {
		const queuedMessage = createQueuedMessage();
		let queuedMessages = [queuedMessage];
		const setQueuedMessages = vi.fn(
			(
				updater: (messages: QueuedFollowUpMessage[]) => QueuedFollowUpMessage[],
			) => {
				queuedMessages = updater(queuedMessages);
			},
		);
		const onSteerStart = vi.fn();
		tokenMocks.getCachedConvexToken.mockResolvedValue(null);

		const { result } = renderHook(() =>
			useQueuedFollowUpControls({
				acceptedQueuedMessageIdsRef,
				acceptedQueuedMessageId: null,
				activeRun: { _id: runId, status: "running" },
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				manuallySendingQueuedMessageIdRef,
				onEditMessage: vi.fn(),
				onSteerStart,
				queuedMessages,
				sendMessage: vi.fn(),
				setQueuedMessages,
				workspaceId,
			}),
		);

		await act(async () => {
			await result.current.sendQueuedFollowUpNow("queued-1");
		});

		expect(onSteerStart).not.toHaveBeenCalled();
		expect(queuedMessages).toEqual([queuedMessage]);
	});

	it("ignores duplicate manual steer sends while one is pending", async () => {
		const queuedMessage = createQueuedMessage();
		let queuedMessages = [queuedMessage];
		const setQueuedMessages = vi.fn(
			(
				updater: (messages: QueuedFollowUpMessage[]) => QueuedFollowUpMessage[],
			) => {
				queuedMessages = updater(queuedMessages);
			},
		);
		let resolveSend: (() => void) | null = null;
		const sendMessage = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveSend = resolve;
				}),
		);
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");

		const { result } = renderHook(() =>
			useQueuedFollowUpControls({
				acceptedQueuedMessageIdsRef,
				acceptedQueuedMessageId: null,
				activeRun: { _id: runId, status: "running" },
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				manuallySendingQueuedMessageIdRef,
				onEditMessage: vi.fn(),
				onSteerStart: vi.fn(),
				queuedMessages,
				sendMessage,
				setQueuedMessages,
				workspaceId,
			}),
		);

		await act(async () => {
			const firstSend = result.current.sendQueuedFollowUpNow("queued-1");
			const secondSend = result.current.sendQueuedFollowUpNow("queued-1");
			await secondSend;
			await waitFor(() => {
				expect(sendMessage).toHaveBeenCalledOnce();
			});
			expect(sendMessage).toHaveBeenCalledOnce();
			resolveSend?.();
			await firstSend;
		});

		expect(sendMessage).toHaveBeenCalledOnce();
	});

	it("does not defer another manual steer across an active-run change", async () => {
		const firstQueuedMessage = createQueuedMessage({
			id: "queued-1",
			messageId: "queued-message-1",
			text: "First steer",
		});
		const secondQueuedMessage = createQueuedMessage({
			id: "queued-2",
			messageId: "queued-message-2",
			text: "Second steer",
		});
		let queuedMessages = [firstQueuedMessage, secondQueuedMessage];
		const setQueuedMessages = vi.fn(
			(
				updater: (messages: QueuedFollowUpMessage[]) => QueuedFollowUpMessage[],
			) => {
				queuedMessages = updater(queuedMessages);
			},
		);
		const sendSettlers: Array<{
			reject: (error: Error) => void;
			resolve: () => void;
		}> = [];
		const sendMessage = vi.fn(
			() =>
				new Promise<void>((resolve, reject) => {
					sendSettlers.push({ reject, resolve });
				}),
		);
		const firstRollback = vi.fn();
		const secondRollback = vi.fn();
		const onSteerStart = vi
			.fn()
			.mockReturnValueOnce(firstRollback)
			.mockReturnValueOnce(secondRollback);
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");
		let acceptedQueuedMessageId: string | null = null;
		let activeRun: AttachableAssistantRunQueryResult = {
			_id: runId,
			status: "running",
		};

		const { result, rerender } = renderHook(() =>
			useQueuedFollowUpControls({
				acceptedQueuedMessageIdsRef,
				acceptedQueuedMessageId,
				activeRun,
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				manuallySendingQueuedMessageIdRef,
				onEditMessage: vi.fn(),
				onSteerStart,
				queuedMessages,
				sendMessage,
				setQueuedMessages,
				workspaceId,
			}),
		);

		let firstSend: Promise<unknown>;
		let secondSend: Promise<unknown>;
		await act(async () => {
			firstSend = result.current.sendQueuedFollowUpNow("queued-1");
			secondSend = result.current.sendQueuedFollowUpNow("queued-2");
		});
		await waitFor(() => {
			expect(sendMessage).toHaveBeenCalledOnce();
		});
		expect(result.current.queuedFollowUps).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "queued-1", isActionDisabled: true }),
				expect.objectContaining({ id: "queued-2", isActionDisabled: true }),
			]),
		);
		expect(sendMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ text: "First steer" }),
			{
				body: {
					...DEFAULT_CHAT_SETTINGS,
					convexToken: "fresh-token",
					continueRunId: runId,
					localCapabilitySession: null,
					projectId: null,
					steerQueuedMessageId: "queued-1",
					timezone: "UTC",
					workspaceId,
				},
			},
		);
		acceptedQueuedMessageIdsRef.current.add("queued-1");
		manuallySendingQueuedMessageIdRef.current = null;
		acceptedQueuedMessageId = "queued-1";
		const nextRunId = "run-2" as Id<"assistantRuns">;
		activeRun = { _id: nextRunId, status: "running" };
		rerender();
		expect(result.current.queuedFollowUps[1]).toMatchObject({
			id: "queued-2",
			isActionDisabled: false,
		});
		let acceptedSecondSend: Promise<unknown>;
		await act(async () => {
			acceptedSecondSend = result.current.sendQueuedFollowUpNow("queued-2");
		});
		await waitFor(() => {
			expect(sendMessage).toHaveBeenCalledTimes(2);
		});
		expect(sendMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ text: "Second steer" }),
			expect.objectContaining({
				body: expect.objectContaining({
					continueRunId: nextRunId,
					steerQueuedMessageId: "queued-2",
				}),
			}),
		);

		await act(async () => {
			sendSettlers[0]?.reject(new Error("accepted stream failed"));
			await firstSend;
			await secondSend;
		});
		expect(firstRollback).not.toHaveBeenCalled();
		expect(result.current.queuedFollowUps[1]).toMatchObject({
			id: "queued-2",
			isActionDisabled: true,
		});
		await act(async () => {
			sendSettlers[1]?.resolve();
			await acceptedSecondSend;
		});
		expect(secondRollback).not.toHaveBeenCalled();

		expect(sendMessage).toHaveBeenCalledTimes(2);
		expect(queuedMessages).toEqual([firstQueuedMessage, secondQueuedMessage]);
	});

	it("labels active rows as Steer without hiding them during submission", async () => {
		const queuedMessage = createQueuedMessage();
		let queuedMessages = [queuedMessage];
		const setQueuedMessages = vi.fn(
			(
				updater: (messages: QueuedFollowUpMessage[]) => QueuedFollowUpMessage[],
			) => {
				queuedMessages = updater(queuedMessages);
			},
		);
		const sendMessage = vi.fn().mockResolvedValue(undefined);
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");

		const { result } = renderHook(() =>
			useQueuedFollowUpControls({
				acceptedQueuedMessageIdsRef,
				acceptedQueuedMessageId: null,
				activeRun: { _id: runId, status: "running" },
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				manuallySendingQueuedMessageIdRef,
				onEditMessage: vi.fn(),
				queuedMessages,
				sendMessage,
				setQueuedMessages,
				workspaceId,
			}),
		);

		expect(result.current.queuedFollowUps[0]).toMatchObject({
			actionLabel: "Steer",
			statusLabel: "Queued",
		});
		await act(async () => {
			await result.current.sendQueuedFollowUpNow("queued-1");
		});

		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ text: "Steer now" }),
			expect.objectContaining({
				body: expect.objectContaining({
					continueRunId: runId,
					steerQueuedMessageId: "queued-1",
				}),
			}),
		);
		expect(queuedMessages).toEqual([queuedMessage]);
	});

	it("keeps remaining rows steerable during a locally streaming FIFO continuation", () => {
		const firstQueuedMessage = createQueuedMessage({
			id: "queued-2",
			text: "Second queued message",
		});
		const secondQueuedMessage = createQueuedMessage({
			id: "queued-3",
			text: "Third queued message",
		});
		const durableActiveRun = {
			_id: runId,
			assistantMessageId: "assistant-continuation",
			status: "running" as const,
		};
		const queueActiveRun = resolveRendererQueueActiveRun({
			activeRun: durableActiveRun,
			displayActiveRun: null,
			isAiRequestPending: true,
		});

		const { result } = renderHook(() =>
			useQueuedFollowUpControls({
				acceptedQueuedMessageIdsRef,
				acceptedQueuedMessageId: null,
				activeRun: queueActiveRun,
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				manuallySendingQueuedMessageIdRef,
				onEditMessage: vi.fn(),
				queuedMessages: [firstQueuedMessage, secondQueuedMessage],
				sendMessage: vi.fn(),
				setQueuedMessages: vi.fn(),
				workspaceId,
			}),
		);

		expect(result.current.queuedFollowUps).toEqual([
			expect.objectContaining({ id: "queued-2", actionLabel: "Steer" }),
			expect.objectContaining({ id: "queued-3", actionLabel: "Steer" }),
		]);
	});

	it("exposes no replay action while an accepted row is handing off to its continuation", async () => {
		const queuedMessages = [
			createQueuedMessage({ id: "queued-2", text: "Second queued message" }),
			createQueuedMessage({ id: "queued-3", text: "Third queued message" }),
		];
		const sendMessage = vi.fn();
		let activeRun: AttachableAssistantRunQueryResult = null;
		let isQueueHandoffPending = true;
		const { result, rerender } = renderHook(() =>
			useQueuedFollowUpControls({
				acceptedQueuedMessageIdsRef,
				acceptedQueuedMessageId: "queued-1",
				activeRun,
				chatId: "chat-1",
				contextLabel: "chat",
				isQueueHandoffPending,
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				manuallySendingQueuedMessageIdRef,
				onEditMessage: vi.fn(),
				queuedMessages,
				sendMessage,
				setQueuedMessages: vi.fn(),
				workspaceId,
			}),
		);

		expect(result.current.queuedFollowUps).toEqual([
			expect.objectContaining({
				actionLabel: null,
				id: "queued-2",
				isActionDisabled: true,
			}),
			expect.objectContaining({
				actionLabel: null,
				id: "queued-3",
				isActionDisabled: true,
			}),
		]);

		await act(async () => {
			await result.current.sendQueuedFollowUpNow("queued-2");
		});
		expect(sendMessage).not.toHaveBeenCalled();

		activeRun = { _id: runId, status: "running" };
		isQueueHandoffPending = false;
		rerender();
		expect(result.current.queuedFollowUps).toEqual([
			expect.objectContaining({ id: "queued-2", actionLabel: "Steer" }),
			expect.objectContaining({ id: "queued-3", actionLabel: "Steer" }),
		]);
	});

	it.each([
		"paused",
		"queued",
	] as const)("labels an inactive %s row as Retry and submits a manual replay intent", async (status) => {
		const queuedMessage = createQueuedMessage({ status });
		let queuedMessages = [queuedMessage];
		const setQueuedMessages = vi.fn(
			(
				updater: (messages: QueuedFollowUpMessage[]) => QueuedFollowUpMessage[],
			) => {
				queuedMessages = updater(queuedMessages);
			},
		);
		const onSteerStart = vi.fn();
		const sendMessage = vi.fn().mockResolvedValue(undefined);
		tokenMocks.getCachedConvexToken.mockResolvedValue("fresh-token");

		const { result } = renderHook(() =>
			useQueuedFollowUpControls({
				acceptedQueuedMessageIdsRef,
				acceptedQueuedMessageId: null,
				activeRun: null,
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				manuallySendingQueuedMessageIdRef,
				onEditMessage: vi.fn(),
				onSteerStart,
				queuedMessages,
				sendMessage,
				setQueuedMessages,
				workspaceId,
			}),
		);

		expect(result.current.queuedFollowUps[0]).toMatchObject({
			actionLabel: "Retry",
			statusLabel: status === "paused" ? "Paused" : "Queued",
		});
		await act(async () => {
			await result.current.sendQueuedFollowUpNow("queued-1");
		});

		expect(onSteerStart).not.toHaveBeenCalled();
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ text: "Steer now" }),
			{
				body: {
					...DEFAULT_CHAT_SETTINGS,
					convexToken: "fresh-token",
					localCapabilitySession: null,
					projectId: null,
					replayQueuedMessageId: "queued-1",
					replayQueuedMessageOrigin: "manual",
					replayQueuedMessageStatus: status,
					timezone: "UTC",
					workspaceId,
				},
			},
		);
		expect(queuedMessages).toEqual([queuedMessage]);
	});

	it("keeps interrupted rows sendless until the queue is resumed", async () => {
		const queuedMessage = createQueuedMessage({
			pauseReason: "interrupted",
			status: "paused",
		});
		const sendMessage = vi.fn();

		const { result } = renderHook(() =>
			useQueuedFollowUpControls({
				acceptedQueuedMessageIdsRef,
				acceptedQueuedMessageId: null,
				activeRun: null,
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				manuallySendingQueuedMessageIdRef,
				onEditMessage: vi.fn(),
				queuedMessages: [queuedMessage],
				sendMessage,
				setQueuedMessages: vi.fn(),
				workspaceId,
			}),
		);

		expect(result.current.queuedFollowUps[0]).toMatchObject({
			actionLabel: null,
			pauseReason: "interrupted",
		});
		await act(async () => {
			await result.current.sendQueuedFollowUpNow(queuedMessage._id);
		});
		expect(sendMessage).not.toHaveBeenCalled();
	});

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
				acceptedQueuedMessageIdsRef,
				acceptedQueuedMessageId: null,
				activeRun: { _id: runId, status: "running" },
				chatId: "chat-1",
				contextLabel: "chat",
				latestRequestBodyRef: { current: null },
				localMessageIds: new Set(),
				manuallySendingQueuedMessageIdRef,
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
