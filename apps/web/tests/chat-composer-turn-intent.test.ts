import { describe, expect, it, vi } from "vitest";
import {
	claimChatComposerTurnIntent,
	commitChatComposerTurnIntent,
} from "@/lib/chat-composer-turn-intent";

type CommitComposerTurnIntentArgs = Parameters<
	typeof commitChatComposerTurnIntent
>[0];

const requestBody = {
	chatMode: "default" as const,
	convexToken: "token",
	localCapabilitySession: null,
	model: "gpt-5.6-sol",
	projectId: null,
	recipeSlug: null,
	reasoningEffort: "medium" as const,
	selectedSourceIds: [],
	serviceTier: "auto" as const,
	timezone: "UTC",
	webSearchEnabled: false,
	workspaceId: "workspace-1",
};

const createArgs = () => {
	const restoreIfCurrent = vi.fn();
	return {
		attachedFiles: [],
		claimIntent: vi.fn(() => ({ restoreIfCurrent })),
		editingMessageId: null,
		isQueuedMessageEditCurrent: vi.fn(() => true),
		onBeforeSubmit: vi.fn(),
		onRequestPrepared: vi.fn(),
		prepareTurn: vi.fn(() => ({
			buildRequestBody: async () => requestBody,
			text: "Continue",
		})),
		queuedMessageEditId: null,
		restoreIfCurrent,
		submitTurn: vi.fn(async () => ({ status: "sent" as const })),
		updateQueuedTurn: vi.fn(async () => true),
	};
};

describe("chat composer turn intent", () => {
	it("commits a new turn through the submit path", async () => {
		const args = createArgs();
		const events: string[] = [];
		args.onBeforeSubmit.mockImplementation(() => {
			events.push("before-submit");
		});
		args.onRequestPrepared.mockImplementation(() => {
			events.push("request-prepared");
		});
		args.submitTurn.mockImplementation(async (input) => {
			events.push("submit-started");
			input.onRequestPrepared({
				localCapabilitySession: null,
				requestBody,
			});
			events.push("submit-finished");
			return { status: "sent" };
		});

		const result = await commitChatComposerTurnIntent(args);

		expect(result).toEqual({ status: "sent" });
		expect(events).toEqual([
			"before-submit",
			"submit-started",
			"request-prepared",
			"submit-finished",
		]);
		expect(args.submitTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				attachedFiles: [],
				editingMessageId: null,
				text: "Continue",
			}),
		);
		expect(args.updateQueuedTurn).not.toHaveBeenCalled();
		expect(args.restoreIfCurrent).not.toHaveBeenCalled();
	});

	it("updates a queued edit without starting a new turn", async () => {
		const args = createArgs();
		args.queuedMessageEditId = "queued-1";
		args.updateQueuedTurn.mockImplementation(async (input) => {
			input.onRequestPrepared({
				localCapabilitySession: null,
				requestBody,
			});
			return true;
		});

		const result = await commitChatComposerTurnIntent(args);

		expect(result).toEqual({ status: "updated" });
		expect(args.updateQueuedTurn).toHaveBeenCalledWith(
			expect.objectContaining({ text: "Continue" }),
		);
		expect(args.onBeforeSubmit).not.toHaveBeenCalled();
		expect(args.submitTurn).not.toHaveBeenCalled();
		expect(args.onRequestPrepared).toHaveBeenCalledOnce();
	});

	it("keeps the draft untouched when a queued edit is no longer current", async () => {
		const args = createArgs();
		args.queuedMessageEditId = "queued-1";
		args.updateQueuedTurn.mockResolvedValue(false);

		const result = await commitChatComposerTurnIntent(args);

		expect(result).toEqual({ status: "stale_edit" });
		expect(args.onRequestPrepared).not.toHaveBeenCalled();
		expect(args.restoreIfCurrent).toHaveBeenCalledOnce();
	});

	it("leaves the unclaimed draft untouched when synchronous preparation fails", async () => {
		const args = createArgs();
		args.prepareTurn.mockImplementation(() => {
			throw new Error("local folder unavailable");
		});

		await expect(commitChatComposerTurnIntent(args)).rejects.toThrow(
			"local folder unavailable",
		);
		expect(args.claimIntent).not.toHaveBeenCalled();
		expect(args.restoreIfCurrent).not.toHaveBeenCalled();
	});

	it("does not restore a queued edit that was replaced while failing", async () => {
		const args = createArgs();
		args.queuedMessageEditId = "queued-1";
		args.isQueuedMessageEditCurrent.mockReturnValue(false);
		args.updateQueuedTurn.mockRejectedValue(new Error("update failed"));

		await expect(commitChatComposerTurnIntent(args)).rejects.toThrow(
			"update failed",
		);
		expect(args.restoreIfCurrent).not.toHaveBeenCalled();
	});

	it("claims one draft revision immediately and never clears a newer draft", async () => {
		let draft = { revision: 0, text: "B" };
		let attachments = { revision: 0, value: [] as string[] };
		const capturedDraft = draft;
		const capturedAttachments = attachments;
		let finishSubmit!: (result: { status: "queued" }) => void;
		const pendingSubmit = new Promise<{ status: "queued" }>((resolve) => {
			finishSubmit = resolve;
		});
		let preparedInput:
			| Parameters<CommitComposerTurnIntentArgs["submitTurn"]>[0]
			| undefined;
		const submitTurn: CommitComposerTurnIntentArgs["submitTurn"] = vi.fn(
			(input) => {
				preparedInput = input;
				return pendingSubmit;
			},
		);
		const claimIntent = vi.fn(() => {
			let draftClaimRevision: number | null = null;
			let attachmentsClaimRevision: number | null = null;
			return claimChatComposerTurnIntent({
				claimAttachments: () => {
					if (attachments.revision !== capturedAttachments.revision) {
						return null;
					}
					attachmentsClaimRevision = attachments.revision + 1;
					attachments = {
						revision: attachmentsClaimRevision,
						value: [],
					};
					return attachmentsClaimRevision;
				},
				claimDraft: () => {
					if (draft.revision !== capturedDraft.revision) {
						return null;
					}
					draftClaimRevision = draft.revision + 1;
					draft = { revision: draftClaimRevision, text: "" };
					return draftClaimRevision;
				},
				isAttachmentsClaimCurrent: (revision) =>
					attachments.revision === revision,
				isDraftClaimCurrent: (revision) => draft.revision === revision,
				onClaim: vi.fn(),
				onRestore: vi.fn(),
				restoreAttachments: () => {
					attachments = {
						revision: (attachmentsClaimRevision ?? 0) + 1,
						value: capturedAttachments.value,
					};
				},
				restoreDraft: () => {
					draft = {
						revision: (draftClaimRevision ?? 0) + 1,
						text: capturedDraft.text,
					};
				},
			});
		});
		const args = {
			...createArgs(),
			claimIntent,
			prepareTurn: vi.fn(() => ({
				buildRequestBody: async () => requestBody,
				text: capturedDraft.text,
			})),
			submitTurn,
		};

		const firstCommit = commitChatComposerTurnIntent(args);
		expect(draft.text).toBe("");

		const duplicateCommit = commitChatComposerTurnIntent(args);
		await expect(duplicateCommit).resolves.toEqual({ status: "stale_intent" });
		expect(submitTurn).toHaveBeenCalledOnce();

		draft = { revision: draft.revision + 1, text: "D" };
		preparedInput?.onRequestPrepared({
			localCapabilitySession: null,
			requestBody,
		});
		expect(draft.text).toBe("D");

		finishSubmit({ status: "queued" });
		await expect(firstCommit).resolves.toEqual({ status: "queued" });
		expect(draft.text).toBe("D");
	});

	it("does not restore a failed intent over a newer draft revision", async () => {
		let draft = { revision: 0, text: "B" };
		const capturedDraft = draft;
		let rejectSubmit!: (error: Error) => void;
		const pendingSubmit = new Promise<never>((_resolve, reject) => {
			rejectSubmit = reject;
		});
		const args = {
			...createArgs(),
			claimIntent: () => {
				const claimedRevision = draft.revision + 1;
				draft = { revision: claimedRevision, text: "" };
				return {
					restoreIfCurrent: () => {
						if (draft.revision === claimedRevision) {
							draft = {
								revision: draft.revision + 1,
								text: capturedDraft.text,
							};
						}
					},
				};
			},
			submitTurn: vi.fn(() => pendingSubmit),
		};

		const commit = commitChatComposerTurnIntent(args);
		draft = { revision: draft.revision + 1, text: "D" };
		const submitError = new Error("B setup failed");
		rejectSubmit(submitError);

		await expect(commit).rejects.toBe(submitError);
		expect(draft.text).toBe("D");
	});
});
