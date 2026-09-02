import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	type ChatTurnAdmission,
	useChatTurnAdmission,
} from "@/hooks/use-chat-turn-admission";
import type { AttachableAssistantRun } from "@/lib/attachable-assistant-run";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import { submitChatTurn } from "@/lib/chat-submit-session";
import type { Id } from "../../../convex/_generated/dataModel";

const activeRun = {
	_id: "run-1" as Id<"assistantRuns">,
	assistantMessageId: "assistant-1",
	chatId: "chat-1" as Id<"chats">,
	createdAt: 1,
	lastHeartbeatAt: 1,
	lastProgressAt: 1,
	leaseExpiresAt: 2,
	ownerTokenIdentifier: "owner",
	producer: "web",
	status: "running",
	updatedAt: 1,
	workspaceId: "workspace-1" as Id<"workspaces">,
} satisfies AttachableAssistantRun;

const queuedMessage = {
	_id: "queued-1" as Id<"assistantQueuedMessages">,
	_creationTime: 1,
	chatId: "chat-1" as Id<"chats">,
	claimVersion: 0,
	createdAt: 1,
	messageId: "message-c",
	ownerTokenIdentifier: "owner",
	requestBodyJson: "{}",
	runId: activeRun._id,
	status: "queued",
	text: "C",
	updatedAt: 1,
	workspaceId: activeRun.workspaceId,
} satisfies QueuedFollowUpMessage;

describe("useChatTurnAdmission", () => {
	it("keeps a successful direct handoff queue-aware until the durable run attaches", async () => {
		let queueActiveRun: AttachableAssistantRun | null = null;
		const { result, rerender } = renderHook(() =>
			useChatTurnAdmission({
				isAiRequestPending: false,
				queueActiveRun,
				scopeKey: "chat-1",
			}),
		);

		await expect(
			result.current.runTurnAdmission(async (admission) => admission.status),
		).resolves.toBe("direct");

		await expect(
			result.current.runTurnAdmission(async (admission) => admission.status),
		).resolves.toBe("current_run");

		queueActiveRun = activeRun;
		rerender();
		await act(() => Promise.resolve());
		queueActiveRun = null;
		rerender();
		await act(() => Promise.resolve());

		await expect(
			result.current.runTurnAdmission(async (admission) => admission.status),
		).resolves.toBe("direct");
	});

	it("keeps a server-approved direct fallback queue-aware", async () => {
		const { result } = renderHook(() =>
			useChatTurnAdmission({
				isAiRequestPending: false,
				queueActiveRun: null,
				scopeKey: "chat-1",
			}),
		);

		await result.current.runTurnAdmission(async () => undefined);
		await result.current.runTurnAdmission(async (admission) => {
			expect(admission.status).toBe("current_run");
			if (admission.status === "current_run") {
				admission.beginDirectSubmission();
			}
		});

		await expect(
			result.current.runTurnAdmission(async (admission) => admission.status),
		).resolves.toBe("current_run");
	});

	it("holds concurrent B and C behind A until A owns a durable run", async () => {
		let queueActiveRun: AttachableAssistantRun | null = null;
		const { result, rerender } = renderHook(() =>
			useChatTurnAdmission({
				isAiRequestPending: false,
				queueActiveRun,
				scopeKey: "chat-1",
			}),
		);
		let finishFirst!: () => void;
		const firstResponse = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		let finishSecond!: () => void;
		const secondAdmission = new Promise<void>((resolve) => {
			finishSecond = resolve;
		});
		const admitted: string[] = [];

		const firstTurn = result.current.runTurnAdmission(async (admission) => {
			admitted.push(`A:${admission.status}`);
			await firstResponse;
			return "A";
		});
		const secondTurn = result.current.runTurnAdmission(async (admission) => {
			admitted.push(`B:${admission.status}`);
			await secondAdmission;
			if (admission.status === "current_run") {
				admission.completeQueuedAdmission();
			}
			return "B";
		});
		const thirdTurn = result.current.runTurnAdmission(async (admission) => {
			admitted.push(`C:${admission.status}`);
			return "C";
		});

		await Promise.resolve();
		expect(admitted).toEqual(["A:direct"]);

		queueActiveRun = activeRun;
		rerender();
		await act(() => Promise.resolve());
		expect(admitted).toEqual(["A:direct", "B:current_run"]);

		finishSecond();
		await secondTurn;
		await expect(thirdTurn).resolves.toBe("C");
		expect(admitted).toEqual(["A:direct", "B:current_run", "C:current_run"]);

		finishFirst();

		await expect(
			Promise.all([firstTurn, secondTurn, thirdTurn]),
		).resolves.toEqual(["A", "B", "C"]);
	});

	it("releases B and C in FIFO order when A setup fails", async () => {
		let queueActiveRun: AttachableAssistantRun | null = null;
		const { result, rerender } = renderHook(() =>
			useChatTurnAdmission({
				isAiRequestPending: false,
				queueActiveRun,
				scopeKey: "chat-1",
			}),
		);
		const setupError = new Error("A setup failed");
		const admitted: string[] = [];
		let finishSecond!: () => void;
		const secondStream = new Promise<void>((resolve) => {
			finishSecond = resolve;
		});

		const firstTurn = result.current.runTurnAdmission(async (admission) => {
			admitted.push(`A:${admission.status}`);
			throw setupError;
		});
		const secondTurn = result.current.runTurnAdmission(async (admission) => {
			admitted.push(`B:${admission.status}`);
			await secondStream;
			return "B";
		});
		const thirdTurn = result.current.runTurnAdmission(async (admission) => {
			admitted.push(`C:${admission.status}`);
			return "C";
		});

		await expect(firstTurn).rejects.toBe(setupError);
		await waitFor(() => {
			expect(admitted).toEqual(["A:direct", "B:direct"]);
		});

		queueActiveRun = activeRun;
		rerender();

		await expect(thirdTurn).resolves.toBe("C");
		finishSecond();
		await expect(Promise.all([secondTurn, thirdTurn])).resolves.toEqual([
			"B",
			"C",
		]);
		expect(admitted).toEqual(["A:direct", "B:direct", "C:current_run"]);
	});

	it("lets C queue after B starts a replacement run without waiting for B to finish", async () => {
		let queueActiveRun: AttachableAssistantRun | null = null;
		let isAiRequestPending = true;
		const { result, rerender } = renderHook(() =>
			useChatTurnAdmission({
				isAiRequestPending,
				queueActiveRun,
				scopeKey: "chat-1",
			}),
		);
		let finishB!: () => void;
		const bStream = new Promise<void>((resolve) => {
			finishB = resolve;
		});
		const admitQueuedMessage = vi
			.fn()
			.mockResolvedValueOnce({ status: "no_active" });
		const enqueueQueuedMessage = vi.fn(async () => queuedMessage);
		const preparedTexts: string[] = [];
		const sentTexts: string[] = [];
		const submit = (text: string, admission: ChatTurnAdmission) =>
			submitChatTurn({
				attachedFiles: [],
				buildRequestBody: async () => ({
					localCapabilitySession: null,
					model: "gpt-5.6-luna",
				}),
				chatId: "chat-1",
				currentRunAdmission:
					admission.status === "current_run"
						? { ...admission, admitQueuedMessage }
						: admission,
				displayActiveRun: null,
				editingMessageId: null,
				enqueueQueuedMessage,
				onOptimisticMessage: vi.fn(),
				onRequestPrepared: () => {
					preparedTexts.push(text);
				},
				onQueuedMessageSaved: vi.fn(),
				queueActiveRun,
				sendMessage: ({ text: sentText }) => {
					sentTexts.push(sentText);
					return bStream;
				},
				text,
				workspaceId: activeRun.workspaceId,
			});

		const secondTurn = result.current.runTurnAdmission((admission) =>
			submit("B", admission),
		);
		const thirdTurn = result.current.runTurnAdmission((admission) =>
			submit("C", admission),
		);

		await waitFor(() => {
			expect(admitQueuedMessage).toHaveBeenCalledTimes(1);
			expect(sentTexts).toEqual(["B"]);
		});
		expect(preparedTexts).toEqual(["B"]);

		queueActiveRun = activeRun;
		isAiRequestPending = true;
		rerender();

		await expect(thirdTurn).resolves.toEqual({ status: "queued" });
		expect(preparedTexts).toEqual(["B", "C"]);
		expect(admitQueuedMessage).toHaveBeenCalledOnce();
		expect(enqueueQueuedMessage).toHaveBeenCalledOnce();

		let bFinished = false;
		void secondTurn.then(() => {
			bFinished = true;
		});
		await Promise.resolve();
		expect(bFinished).toBe(false);

		finishB();
		await expect(secondTurn).resolves.toEqual({ status: "sent" });
	});

	it("promotes B to direct after A fails so B can keep its attachment", async () => {
		let isAiRequestPending = false;
		const { result, rerender } = renderHook(() =>
			useChatTurnAdmission({
				isAiRequestPending,
				queueActiveRun: null,
				scopeKey: "chat-1",
			}),
		);
		const setupError = new Error("A setup failed");
		let rejectFirst!: (error: Error) => void;
		const firstSetup = new Promise<never>((_resolve, reject) => {
			rejectFirst = reject;
		});
		const firstTurn = result.current.runTurnAdmission(async () => firstSetup);
		void firstTurn.catch(() => undefined);
		await act(() => Promise.resolve());
		isAiRequestPending = true;
		rerender();
		const sendMessage = vi.fn(async () => undefined);
		const secondTurn = result.current.runTurnAdmission((admission) =>
			submitChatTurn({
				attachedFiles: [
					{
						filename: "b.txt",
						id: "attachment-b",
						mediaType: "text/plain",
						type: "file",
						uploadStatus: "ready",
						url: "convex://b",
					},
				],
				buildRequestBody: async () => ({
					localCapabilitySession: null,
					model: "gpt-5.6-luna",
				}),
				chatId: "chat-1",
				currentRunAdmission:
					admission.status === "current_run"
						? {
								...admission,
								admitQueuedMessage: vi.fn(),
							}
						: admission,
				displayActiveRun: null,
				editingMessageId: null,
				enqueueQueuedMessage: vi.fn(),
				onOptimisticMessage: vi.fn(),
				onRequestPrepared: vi.fn(),
				sendMessage,
				text: "B",
				workspaceId: activeRun.workspaceId,
			}),
		);

		rejectFirst(setupError);
		await expect(firstTurn).rejects.toBe(setupError);
		await expect(secondTurn).resolves.toEqual({ status: "sent" });
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [expect.objectContaining({ filename: "b.txt" })],
				text: "B",
			}),
			expect.anything(),
		);
	});

	it("cancels the old admission chain when the chat scope changes", async () => {
		let scopeKey = "chat-1";
		const { result, rerender } = renderHook(() =>
			useChatTurnAdmission({
				isAiRequestPending: false,
				queueActiveRun: null,
				scopeKey,
			}),
		);
		let finishFirst!: () => void;
		const firstResponse = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		const oldAdmissions: string[] = [];

		const firstTurn = result.current.runTurnAdmission(
			async () => firstResponse,
		);
		const oldSecondTurn = result.current.runTurnAdmission(async (admission) => {
			oldAdmissions.push(admission.status);
			return admission.status;
		});

		scopeKey = "chat-2";
		rerender();
		const newTurn = result.current.runTurnAdmission(
			async (admission) => admission.status,
		);

		await expect(newTurn).resolves.toBe("direct");
		await expect(oldSecondTurn).resolves.toBe("canceled");
		expect(oldAdmissions).toEqual(["canceled"]);

		finishFirst();
		await firstTurn;
	});

	it("cancels an unaccepted queued operation when the session unmounts", async () => {
		const { result, unmount } = renderHook(() =>
			useChatTurnAdmission({
				isAiRequestPending: false,
				queueActiveRun: null,
				scopeKey: "chat-1",
			}),
		);
		let finishFirst!: () => void;
		const firstResponse = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		const firstTurn = result.current.runTurnAdmission(
			async () => firstResponse,
		);
		const secondTurn = result.current.runTurnAdmission(
			async (admission) => admission.status,
		);

		unmount();

		await expect(secondTurn).resolves.toBe("canceled");
		finishFirst();
		await firstTurn;
	});
});
