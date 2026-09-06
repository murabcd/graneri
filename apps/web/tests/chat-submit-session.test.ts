import { CHAT_MODE } from "@workspace/ai/chat-mode";
import { describe, expect, it, vi } from "vitest";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import type { AdmitQueuedChatTurn } from "@/lib/chat-submit-session";
import {
	removeChatMessageById,
	submitChatTurn,
} from "@/lib/chat-submit-session";
import type { Id } from "../../../convex/_generated/dataModel";

const workspaceId = "workspace-1" as Id<"workspaces">;
const runId = "run-1" as Id<"assistantRuns">;

const createCurrentRunAdmission = (
	admitQueuedMessage: AdmitQueuedChatTurn = vi.fn(),
) => ({
	admitQueuedMessage,
	beginDirectSubmission: vi.fn(),
	completeQueuedAdmission: vi.fn(),
	status: "current_run" as const,
});

const createQueuedFollowUpMessage = (text: string): QueuedFollowUpMessage =>
	({
		_id: "queued-message-1" as Id<"assistantQueuedMessages">,
		_creationTime: 1,
		chatId: "chat-doc-1" as Id<"chats">,
		createdAt: 1,
		messageId: "queued-user-message-1",
		ownerTokenIdentifier: "owner",
		filesJson: "[]",
		requestBodyJson: JSON.stringify({
			chatMode: CHAT_MODE.DEFAULT,
			localCapabilitySession: null,
			model: "gpt-5",
			timezone: "UTC",
		}),
		runId,
		status: "queued",
		text,
		updatedAt: 1,
		workspaceId,
	}) as QueuedFollowUpMessage;

describe("chat submit session", () => {
	it("sends a prepared turn with an optimistic message", async () => {
		const optimisticMessages: unknown[] = [];
		const preparedRequests: unknown[] = [];
		const events: string[] = [];
		const sendMessage = vi.fn(async () => undefined);

		const result = await submitChatTurn({
			attachedFiles: [
				{
					id: "attachment-1",
					type: "file",
					mediaType: "text/plain",
					filename: "notes.txt",
					url: "convex://file",
					uploadStatus: "ready",
				},
			],
			buildRequestBody: async () => ({
				convexToken: "token",
				localCapabilitySession: null,
				model: "gpt-5",
				timezone: "UTC",
			}),
			chatId: "chat-1",
			currentRunAdmission: { status: "direct" },
			activeRun: null,
			editingMessageId: null,
			enqueueQueuedMessage: vi.fn(),
			metadata: {
				recipe: { name: "Review", slug: "review" },
				recipeOnly: false,
			},
			onOptimisticMessage: (message) => {
				events.push("optimistic");
				optimisticMessages.push(message);
			},
			onRequestPrepared: (request) => {
				events.push("prepared");
				preparedRequests.push(request);
			},
			sendMessage,
			text: "Summarize this",
			workspaceId,
		});

		expect(result.status).toBe("sent");
		expect(events).toEqual(["prepared", "optimistic"]);
		expect(optimisticMessages).toHaveLength(1);
		expect(preparedRequests).toEqual([
			{
				localCapabilitySession: null,
				requestBody: {
					convexToken: "token",
					localCapabilitySession: null,
					model: "gpt-5",
					timezone: "UTC",
				},
			},
		]);
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [
					expect.objectContaining({
						filename: "notes.txt",
						mediaType: "text/plain",
						type: "file",
						url: "convex://file",
					}),
				],
				metadata: {
					recipe: { name: "Review", slug: "review" },
					recipeOnly: false,
				},
				text: "Summarize this",
			}),
			{
				body: {
					convexToken: "token",
					localCapabilitySession: null,
					model: "gpt-5",
					timezone: "UTC",
				},
			},
		);
	});

	it("admits uploaded attachments while the active run is uncertain", async () => {
		const buildRequestBody = vi.fn(async () => ({
			convexToken: "token",
			localCapabilitySession: null,
			model: "gpt-5",
			timezone: "UTC",
		}));
		const admitQueuedMessage = vi.fn(async () => ({
			status: "queued" as const,
			queuedMessage: createQueuedFollowUpMessage("Use this file"),
		}));
		const enqueueQueuedMessage = vi.fn();
		const onOptimisticMessage = vi.fn();
		const onRequestPrepared = vi.fn();
		const sendMessage = vi.fn();

		const result = await submitChatTurn({
			attachedFiles: [
				{
					id: "attachment-1",
					type: "file",
					mediaType: "text/plain",
					filename: "notes.txt",
					url: "https://storage.test/file",
					providerMetadata: { graneri: { storageId: "file-1", sizeBytes: 10 } },
					uploadStatus: "ready",
				},
			],
			buildRequestBody,
			chatId: "chat-1",
			currentRunAdmission: createCurrentRunAdmission(admitQueuedMessage),
			activeRun: null,
			editingMessageId: null,
			enqueueQueuedMessage,
			onOptimisticMessage,
			onRequestPrepared,
			sendMessage,
			text: "Use this file",
			workspaceId,
		});

		expect(result).toEqual({ status: "queued" });
		expect(
			JSON.parse(admitQueuedMessage.mock.calls[0][0].message.filesJson),
		).toMatchObject([
			{
				filename: "notes.txt",
				providerMetadata: { graneri: { storageId: "file-1" } },
			},
		]);
		expect(buildRequestBody).toHaveBeenCalledOnce();
		expect(admitQueuedMessage).toHaveBeenCalledOnce();
		expect(enqueueQueuedMessage).not.toHaveBeenCalled();
		expect(onOptimisticMessage).not.toHaveBeenCalled();
		expect(onRequestPrepared).toHaveBeenCalledOnce();
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("prepares an edited submission before sending without an optimistic message", async () => {
		const events: string[] = [];
		let editingMessageId: string | null = "message-1";
		const onOptimisticMessage = vi.fn();
		const sendMessage = vi.fn(async () => {
			events.push("sent");
		});

		await submitChatTurn({
			attachedFiles: [],
			buildRequestBody: async () => ({
				localCapabilitySession: null,
				model: "gpt-5",
			}),
			chatId: "chat-1",
			currentRunAdmission: { status: "direct" },
			activeRun: null,
			editingMessageId,
			enqueueQueuedMessage: vi.fn(),
			onOptimisticMessage,
			onRequestPrepared: () => {
				editingMessageId = null;
				events.push("prepared");
			},
			sendMessage,
			text: "Edited message",
			workspaceId,
		});

		expect(editingMessageId).toBeNull();
		expect(events).toEqual(["prepared", "sent"]);
		expect(onOptimisticMessage).not.toHaveBeenCalled();
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				messageId: "message-1",
				text: "Edited message",
			}),
			expect.anything(),
		);
	});

	it("queues follow-ups against the visible active run", async () => {
		const enqueueQueuedMessage = vi.fn(async ({ message }) =>
			createQueuedFollowUpMessage(message.text),
		);
		const sendMessage = vi.fn();
		const onOptimisticMessage = vi.fn();

		const result = await submitChatTurn({
			attachedFiles: [],
			buildRequestBody: async () => ({
				convexToken: "token",
				localCapabilitySession: null,
				model: "gpt-5",
				timezone: "UTC",
			}),
			chatId: "chat-1",
			currentRunAdmission: createCurrentRunAdmission(),
			activeRun: { _id: runId },
			editingMessageId: null,
			enqueueQueuedMessage,
			onOptimisticMessage,
			onRequestPrepared: () => undefined,
			sendMessage,
			text: "Follow up",
			workspaceId,
		});

		expect(result.status).toBe("queued");
		expect(sendMessage).not.toHaveBeenCalled();
		expect(onOptimisticMessage).not.toHaveBeenCalled();
		expect(enqueueQueuedMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				chatId: "chat-1",
				runId,
				workspaceId,
				message: expect.objectContaining({
					text: "Follow up",
				}),
			}),
		);
	});

	it("continues a waiting run immediately for a human decision", async () => {
		const enqueueQueuedMessage = vi.fn();
		const onOptimisticMessage = vi.fn();
		const sendMessage = vi.fn(async () => undefined);

		const result = await submitChatTurn({
			attachedFiles: [],
			buildRequestBody: async () => ({
				convexToken: "token",
				localCapabilitySession: null,
				model: "gpt-5",
				timezone: "UTC",
			}),
			chatId: "chat-1",
			continueRunId: runId,
			currentRunAdmission: { status: "direct" },
			activeRun: { _id: runId },
			editingMessageId: null,
			enqueueQueuedMessage,
			onOptimisticMessage,
			onRequestPrepared: () => undefined,
			sendMessage,
			text: "Current note",
			workspaceId,
		});

		expect(result.status).toBe("sent");
		expect(enqueueQueuedMessage).not.toHaveBeenCalled();
		expect(onOptimisticMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				parts: [{ text: "Current note", type: "text" }],
				role: "user",
			}),
		);
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ text: "Current note" }),
			{
				body: {
					continueRunId: runId,
					convexToken: "token",
					localCapabilitySession: null,
					model: "gpt-5",
					timezone: "UTC",
				},
			},
		);
	});

	it("queues follow-ups against the durable active run", async () => {
		const enqueueQueuedMessage = vi.fn(async ({ message }) =>
			createQueuedFollowUpMessage(message.text),
		);
		const sendMessage = vi.fn();
		const onOptimisticMessage = vi.fn();
		const onQueuedMessageSaved = vi.fn();

		const result = await submitChatTurn({
			attachedFiles: [],
			buildRequestBody: async () => ({
				convexToken: "token",
				localCapabilitySession: null,
				model: "gpt-5",
				timezone: "UTC",
			}),
			chatId: "chat-1",
			currentRunAdmission: createCurrentRunAdmission(),
			editingMessageId: null,
			enqueueQueuedMessage,
			onOptimisticMessage,
			onQueuedMessageSaved,
			onRequestPrepared: () => undefined,
			activeRun: { _id: runId },
			sendMessage,
			text: "Follow up while first answer streams",
			workspaceId,
		});

		expect(result.status).toBe("queued");
		expect(sendMessage).not.toHaveBeenCalled();
		expect(onOptimisticMessage).not.toHaveBeenCalled();
		expect(enqueueQueuedMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				chatId: "chat-1",
				runId,
				workspaceId,
				message: expect.objectContaining({
					text: "Follow up while first answer streams",
				}),
			}),
		);
		expect(onQueuedMessageSaved).toHaveBeenCalledWith({
			queuedMessage: expect.objectContaining({
				_id: "queued-message-1",
				runId,
				status: "queued",
				text: "Follow up while first answer streams",
			}),
		});
	});

	it("atomically queues an uncertain follow-up when the server still owns an active run", async () => {
		const queuedMessage = createQueuedFollowUpMessage(
			"Follow up before the active run query catches up",
		);
		const admitQueuedMessage = vi.fn(async () => ({
			status: "queued" as const,
			queuedMessage,
		}));
		const enqueueQueuedMessage = vi.fn();
		const sendMessage = vi.fn();
		const onOptimisticMessage = vi.fn();
		const onQueuedMessageSaved = vi.fn();

		const result = await submitChatTurn({
			followUpBehaviorOverride: "steer",
			attachedFiles: [],
			buildRequestBody: async () => ({
				convexToken: "token",
				localCapabilitySession: null,
				model: "gpt-5",
				timezone: "UTC",
			}),
			chatId: "chat-1",
			currentRunAdmission: createCurrentRunAdmission(admitQueuedMessage),
			activeRun: null,
			editingMessageId: null,
			enqueueQueuedMessage,
			onOptimisticMessage,
			onQueuedMessageSaved,
			onRequestPrepared: () => undefined,
			sendMessage,
			text: "Follow up before the active run query catches up",
			workspaceId,
		});

		expect(result.status).toBe("queued");
		expect(admitQueuedMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				chatId: "chat-1",
				workspaceId,
				message: expect.objectContaining({
					text: "Follow up before the active run query catches up",
				}),
			}),
		);
		expect(enqueueQueuedMessage).not.toHaveBeenCalled();
		expect(sendMessage).not.toHaveBeenCalled();
		expect(onOptimisticMessage).not.toHaveBeenCalled();
		expect(onQueuedMessageSaved).toHaveBeenCalledWith({
			followUpBehaviorOverride: "steer",
			queuedMessage,
		});
	});

	it("waits for queued-message handoff work before completing submission", async () => {
		const queuedMessage = createQueuedFollowUpMessage("Steer after admission");
		const admitQueuedMessage = vi.fn(async () => ({
			status: "queued" as const,
			queuedMessage,
		}));
		let finishHandoff: (() => void) | undefined;
		const onQueuedMessageSaved = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishHandoff = resolve;
				}),
		);
		let didComplete = false;

		const submission = submitChatTurn({
			attachedFiles: [],
			buildRequestBody: async () => ({
				convexToken: "token",
				localCapabilitySession: null,
				model: "gpt-5",
				timezone: "UTC",
			}),
			chatId: "chat-1",
			currentRunAdmission: createCurrentRunAdmission(admitQueuedMessage),
			activeRun: null,
			editingMessageId: null,
			enqueueQueuedMessage: vi.fn(),
			onOptimisticMessage: vi.fn(),
			onQueuedMessageSaved,
			onRequestPrepared: () => undefined,
			sendMessage: vi.fn(),
			text: "Steer after admission",
			workspaceId,
		}).then((result) => {
			didComplete = true;
			return result;
		});

		await vi.waitFor(() => expect(onQueuedMessageSaved).toHaveBeenCalledOnce());
		expect(didComplete).toBe(false);

		finishHandoff?.();
		await expect(submission).resolves.toEqual({ status: "queued" });
		expect(didComplete).toBe(true);
	});

	it("normal-sends an uncertain follow-up only after the server reports no active run", async () => {
		const admitQueuedMessage = vi.fn(async () => ({
			status: "no_active" as const,
		}));
		const sendMessage = vi.fn(async () => undefined);
		const onOptimisticMessage = vi.fn();

		const result = await submitChatTurn({
			attachedFiles: [],
			buildRequestBody: async () => ({
				convexToken: "token",
				localCapabilitySession: null,
				model: "gpt-5",
				timezone: "UTC",
			}),
			chatId: "chat-1",
			currentRunAdmission: createCurrentRunAdmission(admitQueuedMessage),
			activeRun: null,
			editingMessageId: null,
			enqueueQueuedMessage: vi.fn(),
			onOptimisticMessage,
			onRequestPrepared: () => undefined,
			sendMessage,
			text: "Follow up after actual completion",
			workspaceId,
		});

		expect(result.status).toBe("sent");
		expect(admitQueuedMessage).toHaveBeenCalledOnce();
		expect(onOptimisticMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				id: expect.not.stringMatching(/^queued-/),
				role: "user",
			}),
		);
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				messageId: expect.not.stringMatching(/^queued-/),
				text: "Follow up after actual completion",
			}),
			expect.anything(),
		);
	});

	it("re-admits server-authoritatively when the exact active run becomes stale", async () => {
		const queuedMessage = createQueuedFollowUpMessage(
			"Follow up after completion",
		);
		const admitQueuedMessage = vi.fn(async () => ({
			queuedMessage,
			status: "queued" as const,
		}));
		const enqueueQueuedMessage = vi.fn(async () => {
			throw new Error(
				'[Request ID: test] Server Error Uncaught ConvexError: {"code":"ASSISTANT_RUN_NOT_ACTIVE","message":"Assistant run is not active."}',
			);
		});
		const sendMessage = vi.fn(async () => undefined);
		const onOptimisticMessage = vi.fn();
		const onQueuedMessageSaved = vi.fn();

		const result = await submitChatTurn({
			attachedFiles: [],
			buildRequestBody: async () => ({
				convexToken: "token",
				localCapabilitySession: null,
				model: "gpt-5",
				timezone: "UTC",
			}),
			chatId: "chat-1",
			currentRunAdmission: createCurrentRunAdmission(admitQueuedMessage),
			activeRun: { _id: runId },
			editingMessageId: null,
			enqueueQueuedMessage,
			onOptimisticMessage,
			onQueuedMessageSaved,
			onRequestPrepared: () => undefined,
			sendMessage,
			text: "Follow up after completion",
			workspaceId,
		});

		expect(result.status).toBe("queued");
		expect(enqueueQueuedMessage).toHaveBeenCalledOnce();
		expect(admitQueuedMessage).toHaveBeenCalledOnce();
		expect(onQueuedMessageSaved).toHaveBeenCalledWith({
			queuedMessage,
		});
		expect(onOptimisticMessage).not.toHaveBeenCalled();
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("preserves non-stale active enqueue failures", async () => {
		const enqueueError = new Error("Queued message belongs to another chat.");
		const enqueueQueuedMessage = vi.fn(async () => {
			throw enqueueError;
		});

		await expect(
			submitChatTurn({
				attachedFiles: [],
				buildRequestBody: async () => ({
					convexToken: "token",
					localCapabilitySession: null,
					model: "gpt-5",
					timezone: "UTC",
				}),
				chatId: "chat-1",
				currentRunAdmission: createCurrentRunAdmission(),
				activeRun: { _id: runId },
				editingMessageId: null,
				enqueueQueuedMessage,
				onOptimisticMessage: vi.fn(),
				onRequestPrepared: () => undefined,
				sendMessage: vi.fn(),
				text: "Invalid queued follow up",
				workspaceId,
			}),
		).rejects.toBe(enqueueError);
	});

	it("sends the canonical request body when active state is stale", async () => {
		const preparedRequests: unknown[] = [];
		const sendMessage = vi.fn(async () => undefined);

		const result = await submitChatTurn({
			attachedFiles: [],
			buildRequestBody: async () => ({
				convexToken: "token",
				localCapabilitySession: null,
				model: "gpt-5",
				timezone: "UTC",
			}),
			chatId: "chat-1",
			currentRunAdmission: { status: "direct" },
			activeRun: null,
			editingMessageId: null,
			enqueueQueuedMessage: vi.fn(),
			onOptimisticMessage: vi.fn(),
			onRequestPrepared: (request) => {
				preparedRequests.push(request);
			},
			sendMessage,
			text: "Send with the canonical request shape",
			workspaceId,
		});

		expect(result.status).toBe("sent");
		expect(preparedRequests).toEqual([
			{
				localCapabilitySession: null,
				requestBody: {
					convexToken: "token",
					localCapabilitySession: null,
					model: "gpt-5",
					timezone: "UTC",
				},
			},
		]);
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				text: "Send with the canonical request shape",
			}),
			{ body: preparedRequests[0]?.requestBody },
		);
	});

	it("removes optimistic messages by id", () => {
		expect(
			removeChatMessageById(
				[
					{ id: "keep", role: "user", parts: [] },
					{ id: "remove", role: "user", parts: [] },
				],
				"remove",
			),
		).toEqual([{ id: "keep", role: "user", parts: [] }]);
	});
});
