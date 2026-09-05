import { describe, expect, it, vi } from "vitest";
import { createHostedChatQueuedInput } from "../src/hosted-chat-queued-input.mjs";

const queuedMessage = ({
	id,
	messageId,
	text,
}: {
	id: string;
	messageId: string;
	text: string;
}) => ({
	_id: id,
	claimVersion: 3,
	filesJson: "[]",
	messageId,
	text,
});

describe("hosted chat queued input", () => {
	it("claims only the selected queued message for steering", async () => {
		const selectedMessage = queuedMessage({
			id: "queued-2",
			messageId: "message-2",
			text: "second",
		});
		const claimForSteer = vi.fn().mockResolvedValue(selectedMessage);
		const queuedInput = createHostedChatQueuedInput({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			claimForReplay: vi.fn(),
			claimForSteer,
			releaseClaimed: vi.fn(),
		});

		const claimed = await queuedInput.claimSteer({
			runId: "run-1",
			queuedMessageId: "queued-2",
		});

		expect(claimForSteer).toHaveBeenCalledWith({
			runId: "run-1",
			queuedMessageId: "queued-2",
		});
		expect(queuedInput.hasClaimed).toBe(true);
		expect(queuedInput.claimedLease).toEqual({
			queuedMessageId: "queued-2",
			claimVersion: 3,
		});
		expect(claimed.claimedMessage).toBe(selectedMessage);
		expect(claimed.userMessage).toMatchObject({
			id: "message-2",
			role: "user",
			parts: [{ type: "text", text: "second" }],
		});
	});

	it("claims a selected replay message for the same workspace and chat", async () => {
		const claimForReplay = vi.fn().mockResolvedValue({
			status: "claimed",
			claimedMessage: queuedMessage({
				id: "queued-1",
				messageId: "message-1",
				text: "replay me",
			}),
		});
		const queuedInput = createHostedChatQueuedInput({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			claimForReplay,
			claimForSteer: vi.fn(),
			releaseClaimed: vi.fn(),
		});

		await expect(
			queuedInput.claimReplay({
				expectedStatus: "queued",
				queuedMessageId: "queued-1",
			}),
		).resolves.toMatchObject({
			status: "claimed",
			userMessage: {
				id: "message-1",
				role: "user",
				parts: [{ type: "text", text: "replay me" }],
			},
		});
		expect(claimForReplay).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			expectedStatus: "queued",
			queuedMessageId: "queued-1",
		});
		expect(queuedInput.claimedLease).toEqual({
			queuedMessageId: "queued-1",
			claimVersion: 3,
		});
	});

	it("releases the claimed message and clears local claim state", async () => {
		const releaseClaimed = vi.fn().mockResolvedValue(null);
		const queuedInput = createHostedChatQueuedInput({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			claimForReplay: vi.fn(),
			claimForSteer: vi.fn().mockResolvedValue(
				queuedMessage({
					id: "queued-1",
					messageId: "message-1",
					text: "first",
				}),
			),
			releaseClaimed,
		});

		await queuedInput.claimSteer({
			runId: "run-1",
			queuedMessageId: "queued-1",
		});

		await expect(queuedInput.releaseClaimed()).resolves.toEqual({
			ok: true,
		});
		expect(releaseClaimed).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			queuedMessageId: "queued-1",
			claimVersion: 3,
		});
		expect(queuedInput.hasClaimed).toBe(false);
		expect(queuedInput.claimedLease).toBeNull();
	});

	it("keeps local claim state when release fails", async () => {
		const releaseError = new Error("release failed");
		const queuedInput = createHostedChatQueuedInput({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			claimForReplay: vi.fn(),
			claimForSteer: vi.fn().mockResolvedValue(
				queuedMessage({
					id: "queued-1",
					messageId: "message-1",
					text: "first",
				}),
			),
			releaseClaimed: vi.fn().mockRejectedValue(releaseError),
		});

		await queuedInput.claimSteer({
			runId: "run-1",
			queuedMessageId: "queued-1",
		});

		await expect(queuedInput.releaseClaimed()).resolves.toEqual({
			ok: false,
			error: releaseError,
			queuedMessageId: "queued-1",
		});
		expect(queuedInput.hasClaimed).toBe(true);
		expect(queuedInput.claimedLease).toEqual({
			queuedMessageId: "queued-1",
			claimVersion: 3,
		});
	});

	it("does not clear a newer lease when an older release completes", async () => {
		let completeRelease: (() => void) | undefined;
		const releasePending = new Promise<void>((resolve) => {
			completeRelease = resolve;
		});
		const queuedInput = createHostedChatQueuedInput({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			claimForReplay: vi.fn().mockResolvedValue({
				status: "claimed",
				claimedMessage: queuedMessage({
					id: "queued-2",
					messageId: "message-2",
					text: "second",
				}),
			}),
			claimForSteer: vi.fn().mockResolvedValue(
				queuedMessage({
					id: "queued-1",
					messageId: "message-1",
					text: "first",
				}),
			),
			releaseClaimed: vi.fn(async () => await releasePending),
		});

		await queuedInput.claimSteer({
			runId: "run-1",
			queuedMessageId: "queued-1",
		});
		const releaseResult = queuedInput.releaseClaimed();
		await queuedInput.claimReplay({
			expectedStatus: "queued",
			queuedMessageId: "queued-2",
		});
		completeRelease?.();

		await expect(releaseResult).resolves.toEqual({ ok: true });
		expect(queuedInput.claimedLease).toEqual({
			queuedMessageId: "queued-2",
			claimVersion: 3,
		});
	});

	it.each([
		"active_run",
		"unavailable",
	] as const)("does not create a lease for a %s replay attempt", async (status) => {
		const queuedInput = createHostedChatQueuedInput({
			workspaceId: "workspace-1",
			chatId: "chat-1",
			claimForReplay: vi.fn().mockResolvedValue({ status }),
			claimForSteer: vi.fn(),
			releaseClaimed: vi.fn(),
		});

		await expect(
			queuedInput.claimReplay({
				expectedStatus: "queued",
				queuedMessageId: "queued-1",
			}),
		).resolves.toEqual({ status });
		expect(queuedInput.claimedLease).toBeNull();
	});
});
