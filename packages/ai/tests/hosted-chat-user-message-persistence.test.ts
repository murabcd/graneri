import { describe, expect, it, vi } from "vitest";
import { persistHostedChatUserMessage } from "../src/hosted-chat-user-message-persistence.mjs";

const userMessage = (id: string, text: string) => ({
	id,
	role: "user",
	parts: [{ type: "text", text }],
});

const createQueuedInput = ({ claimedLease = null } = {}) => ({
	get claimedLease() {
		return claimedLease;
	},
	get hasClaimed() {
		return claimedLease !== null;
	},
	clearClaimed: vi.fn(),
});

const createPersistenceArgs = (overrides = {}) => ({
	workspaceId: "workspace-1",
	chatId: "chat-1",
	noteId: null,
	projectId: null,
	nextAssistantMessageId: "assistant-2",
	settings: {
		chatMode: "default",
		model: "gpt-5.6-sol",
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
	},
	message: userMessage("user-1", "Hello"),
	queuedInput: createQueuedInput(),
	acceptQueuedUserMessageAndStartRun: vi.fn(async () => ({
		run: { _id: "run-replay-1", assistantMessageId: "assistant-2" },
	})),
	acceptSteeredUserMessage: vi.fn(async () => null),
	saveMessage: vi.fn(async () => null),
	turnIntent: { type: "direct", continueRunId: null },
	...overrides,
});

describe("hosted chat user message persistence", () => {
	it("rejects unclassified input against a continued run", async () => {
		const args = createPersistenceArgs({
			turnIntent: { type: "direct", continueRunId: "run-1" },
		});

		await expect(persistHostedChatUserMessage(args)).rejects.toThrow(
			"Continued user input must use a claimed queue item.",
		);
		expect(args.saveMessage).not.toHaveBeenCalled();
	});

	it("accepts a claimed replay message with a discriminated result", async () => {
		const queuedInput = createQueuedInput({
			claimedLease: {
				queuedMessageId: "queued-replay-1",
				claimVersion: 4,
			},
		});
		const args = createPersistenceArgs({
			queuedInput,
			turnIntent: {
				type: "replay",
				expectedStatus: "queued",
				queuedMessageId: "queued-replay-1",
			},
		});

		const result = await persistHostedChatUserMessage(args);

		expect(args.acceptQueuedUserMessageAndStartRun).toHaveBeenCalledWith(
			expect.objectContaining({
				queuedMessageId: "queued-replay-1",
				claimVersion: 4,
				message: expect.objectContaining({ id: "user-1" }),
			}),
		);
		expect(result).toEqual({
			type: "replay",
			queuedMessageId: "queued-replay-1",
			acceptance: {
				run: { _id: "run-replay-1", assistantMessageId: "assistant-2" },
			},
		});
		expect(queuedInput.clearClaimed).toHaveBeenCalledOnce();
	});

	it("accepts only the selected claimed steer message and clears the claim", async () => {
		const queuedInput = createQueuedInput({
			claimedLease: {
				queuedMessageId: "queued-1",
				claimVersion: 5,
			},
		});
		const args = createPersistenceArgs({
			message: userMessage("queued-user-1", "Selected"),
			queuedInput,
			turnIntent: {
				type: "steer",
				queuedMessageId: "queued-1",
				runId: "run-1",
			},
		});

		const result = await persistHostedChatUserMessage(args);

		expect(args.acceptSteeredUserMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "run-1",
				queuedMessageId: "queued-1",
				claimVersion: 5,
				message: expect.objectContaining({ id: "queued-user-1" }),
			}),
		);
		expect(args.acceptSteeredUserMessage.mock.calls[0]?.[0]).not.toHaveProperty(
			"nextAssistantMessageId",
		);
		expect(queuedInput.clearClaimed).toHaveBeenCalledOnce();
		expect(result).toEqual({
			type: "steer",
			queuedMessageId: "queued-1",
			runId: "run-1",
		});
	});
});
