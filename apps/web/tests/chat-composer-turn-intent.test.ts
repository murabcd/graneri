import { describe, expect, it, vi } from "vitest";
import { commitChatComposerTurnIntent } from "@/lib/chat-composer-turn-intent";

const requestBody = {
	chatMode: "default" as const,
	convexToken: "token",
	localFolders: [],
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

const createArgs = () => ({
	attachedFiles: [],
	editingMessageId: null,
	isQueuedMessageEditCurrent: vi.fn(() => true),
	onBeforeSubmit: vi.fn(),
	onRequestPrepared: vi.fn(),
	prepareTurn: vi.fn(() => ({
		buildRequestBody: async () => requestBody,
		text: "Continue",
	})),
	queuedMessageEditId: null,
	restoreDraft: vi.fn(),
	submitTurn: vi.fn(async () => ({ status: "sent" as const })),
	updateQueuedTurn: vi.fn(async () => true),
});

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
			input.onRequestPrepared({ localFolders: [], requestBody });
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
		expect(args.restoreDraft).not.toHaveBeenCalled();
	});

	it("updates a queued edit without starting a new turn", async () => {
		const args = createArgs();
		args.queuedMessageEditId = "queued-1";
		args.updateQueuedTurn.mockImplementation(async (input) => {
			input.onRequestPrepared({ localFolders: [], requestBody });
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
		expect(args.restoreDraft).not.toHaveBeenCalled();
	});

	it("restores the captured draft when preparing a current intent fails", async () => {
		const args = createArgs();
		args.prepareTurn.mockImplementation(() => {
			throw new Error("local folder unavailable");
		});

		await expect(commitChatComposerTurnIntent(args)).rejects.toThrow(
			"local folder unavailable",
		);
		expect(args.restoreDraft).toHaveBeenCalledOnce();
	});

	it("does not restore a queued edit that was replaced while failing", async () => {
		const args = createArgs();
		args.queuedMessageEditId = "queued-1";
		args.isQueuedMessageEditCurrent.mockReturnValue(false);
		args.updateQueuedTurn.mockRejectedValue(new Error("update failed"));

		await expect(commitChatComposerTurnIntent(args)).rejects.toThrow(
			"update failed",
		);
		expect(args.restoreDraft).not.toHaveBeenCalled();
	});
});
