import { describe, expect, it, vi } from "vitest";
import { createHostedChatTurnController } from "../src/hosted-chat-turn-controller.mjs";
import { createHostedChatTurnInput } from "../src/hosted-chat-turn-input.mjs";

const userMessage = (id: string, text: string) => ({
	id,
	role: "user",
	parts: [{ type: "text", text }],
});

const createQueuedInput = ({
	claimReplay = vi.fn(),
	claimSteer = vi.fn(),
	releaseClaimed = vi.fn(async () => ({ ok: true })),
} = {}) => ({
	claimReplay,
	claimSteer,
	releaseClaimed,
});

const createController = ({
	attachableRun = {
		_id: "run-1",
		assistantMessageId: "assistant-1",
		producer: "web",
		status: "running",
	},
	queuedInput = createQueuedInput(),
	validateInput = vi.fn(() => ({ ok: true })),
} = {}) =>
	createHostedChatTurnController({
		attachableRun,
		chatId: "chat-1",
		queuedInput,
		validateInput,
		workspaceId: "workspace-1",
	});

describe("hosted chat turn controller", () => {
	it("constructs the coupled queue and controller through one turn-input boundary", async () => {
		const turnInput = createHostedChatTurnInput({
			attachableRun: null,
			chatId: "chat-1",
			claimForReplay: vi.fn(),
			claimForSteer: vi.fn(),
			releaseClaimed: vi.fn(async () => undefined),
			validateInput: vi.fn(() => ({ ok: true })),
			workspaceId: "workspace-1",
		});

		expect(turnInput.queuedInput.hasClaimed).toBe(false);
		await expect(
			turnInput.turnController.prepareInput({
				message: userMessage("message-1", "Hello"),
				turnIntent: { type: "direct", continueRunId: null },
			}),
		).resolves.toMatchObject({
			effectiveMessage: { id: "message-1" },
			ok: true,
		});
	});

	it("claims and validates only the selected input without interrupting its active generation", async () => {
		const selectedMessage = userMessage("queued-1", "Selected");
		const queuedInput = createQueuedInput({
			claimSteer: vi.fn(async () => ({
				claimedMessage: { _id: "queued-1" },
				userMessage: selectedMessage,
			})),
		});
		const controller = createController({ queuedInput });

		const result = await controller.prepareInput({
			turnIntent: {
				type: "steer",
				queuedMessageId: "queued-1",
				runId: "run-1",
			},
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			throw new Error("expected turn input preparation to succeed");
		}
		expect(queuedInput.claimSteer).toHaveBeenCalledWith({
			runId: "run-1",
			queuedMessageId: "queued-1",
		});
		expect(result.effectiveMessage).toBe(selectedMessage);
		expect(result.steeredUserMessage).toBe(selectedMessage);
	});

	it("rejects invalid claimed steer input before accepting it", async () => {
		const queuedInput = createQueuedInput({
			claimSteer: vi.fn(async () => ({
				claimedMessage: { _id: "queued-1" },
				userMessage: userMessage("queued-1", "Too large"),
			})),
		});
		const controller = createController({
			queuedInput,
			validateInput: vi.fn(() => ({
				ok: false,
				error: "Input is too large.",
			})),
		});

		await expect(
			controller.prepareInput({
				turnIntent: {
					type: "steer",
					queuedMessageId: "queued-1",
					runId: "run-1",
				},
			}),
		).resolves.toMatchObject({ ok: false, phase: "input_invalid" });
		expect(queuedInput.releaseClaimed).toHaveBeenCalledOnce();
	});

	it("preserves the authoritative queue rejection when a waiting run cannot accept steer input", async () => {
		const claimSteer = vi.fn(async () => {
			throw new Error("Assistant run is not active.");
		});
		const queuedInput = createQueuedInput({
			claimSteer,
		});
		const validateInput = vi.fn(() => ({ ok: true }));
		const controller = createController({
			attachableRun: {
				_id: "run-1",
				assistantMessageId: "assistant-1",
				producer: "web",
				status: "waiting_for_user",
			},
			queuedInput,
			validateInput,
		});

		await expect(
			controller.prepareInput({
				turnIntent: {
					type: "steer",
					queuedMessageId: "queued-1",
					runId: "run-1",
				},
			}),
		).rejects.toThrow("Assistant run is not active.");
		expect(claimSteer).toHaveBeenCalledOnce();
		expect(validateInput).not.toHaveBeenCalled();
	});

	it("claims replay input without steering an active turn", async () => {
		const message = userMessage("queued-replay", "Replay");
		const queuedInput = createQueuedInput({
			claimReplay: vi.fn(async () => ({
				status: "claimed" as const,
				userMessage: message,
			})),
		});
		const controller = createController({
			attachableRun: null,
			queuedInput,
		});

		const result = await controller.prepareInput({
			turnIntent: {
				type: "replay",
				expectedStatus: "paused",
				queuedMessageId: "queued-replay",
			},
		});

		expect(result.ok).toBe(true);
		expect(queuedInput.claimReplay).toHaveBeenCalledWith({
			expectedStatus: "paused",
			queuedMessageId: "queued-replay",
		});
		if (!result.ok) {
			throw new Error("expected replay input preparation to succeed");
		}
		expect(result.effectiveMessage).toBe(message);
	});

	it.each([
		{
			status: "active_run",
			errorCode: "ASSISTANT_RUN_ACTIVE",
			error: "Chat already has an active assistant run.",
		},
		{
			status: "unavailable",
			errorCode: "QUEUED_MESSAGE_NOT_FOUND",
			error: "Queued message is no longer available.",
		},
	] as const)("projects a $status replay claim attempt into a structured route conflict", async ({
		error,
		errorCode,
		status,
	}) => {
		const queuedInput = createQueuedInput({
			claimReplay: vi.fn(async () => ({ status })),
		});
		const controller = createController({
			attachableRun: null,
			queuedInput,
		});

		await expect(
			controller.prepareInput({
				turnIntent: {
					type: "replay",
					expectedStatus: "queued",
					queuedMessageId: "queued-replay",
				},
			}),
		).resolves.toEqual({
			ok: false,
			phase: "replay_claim_conflict",
			error,
			errorCode,
			statusCode: 409,
		});
	});
});
