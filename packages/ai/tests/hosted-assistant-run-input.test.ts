import { describe, expect, it, vi } from "vitest";
import { prepareHostedAssistantRunInput } from "../src/hosted-assistant-run-input.mjs";
import type { HostedChatContextPreparationState } from "../src/hosted-chat-context-window.mjs";

const inputMocks = vi.hoisted(() => ({
	buildRunContext: vi.fn(async (context) => ({ ...context, tools: {} })),
	validateMessages: vi.fn(async ({ messages }) => messages),
}));

vi.mock("../src/hosted-chat-run-context.mjs", () => ({
	buildHostedChatRunContext: inputMocks.buildRunContext,
}));

vi.mock("../src/ui-message-codec.mjs", async (importOriginal) => ({
	...(await importOriginal()),
	validateUiMessages: inputMocks.validateMessages,
}));

type PreparedInput = Extract<
	Awaited<ReturnType<typeof prepareHostedAssistantRunInput>>,
	{ ok: true }
>;
type CompletionInput = Parameters<PreparedInput["complete"]>[0];

const storedMessage = ({
	id,
	role,
	text,
}: {
	id: string;
	role: "assistant" | "user";
	text: string;
}) => ({
	id,
	role,
	partsJson: JSON.stringify([{ type: "text", text }]),
	createdAt: 1,
});

const contextMessage = (message: ReturnType<typeof storedMessage>) => ({
	...message,
	creationTime: 1,
});

const idleContextWindow = (
	loadState: () => Promise<HostedChatContextPreparationState>,
) => ({
	compactionLifecycle: {
		start: async () => undefined,
		cancel: async () => undefined,
	},
	loadState,
	safetyIdentifier: "owner-1",
	saveCompaction: async () => {
		throw new Error("compaction should not be needed");
	},
});

const createCompletionInput = (): CompletionInput => ({
	appsEnabled: false,
	chatAttachmentsApi: {},
	chatId: "chat-1",
	convexClient: {},
	defaultModel: "gpt-5",
	defaultReasoningEffort: "medium",
	defaultServiceTier: "auto",
	defaultTimezone: "UTC",
	getActiveStreamSession: () => null,
	getNotesContext: async () => "",
	getAppConnections: async () => [],
	getSelectedRecipe: async () => null,
	getStoredNoteContext: async () => "",
	getUserProfileContext: async () => null,
	logLatency: () => undefined,
	resolveLocalFolderRoots: () => [],
	workspaceId: "workspace-1",
});

describe("hosted Assistant Run input", () => {
	it("branches before loading and compacting the final active history", async () => {
		const events: string[] = [];
		const latency: Array<[string, Record<string, unknown> | undefined]> = [];
		const original = storedMessage({
			id: "user-1",
			role: "user",
			text: "Original",
		});
		const retained = storedMessage({
			id: "user-0",
			role: "user",
			text: "Retained",
		});

		const result = await prepareHostedAssistantRunInput({
			branchFromMessage: async () => {
				events.push("branch");
			},
			chatId: "chat-1",
			contextWindow: idleContextWindow(async () => {
				events.push("context");
				return {
					compaction: null,
					hasMoreMessages: false,
					messages: [contextMessage(retained)],
				};
			}),
			getMessagesSnapshot: async () => {
				events.push("snapshot");
				return [retained, original];
			},
			listRunEventsAfter: async () => [],
			logLatency: (stage, details) => latency.push([stage, details]),
			message: {
				id: "user-1-edited",
				role: "user",
				parts: [{ type: "text", text: "Edited" }],
			},
			messageId: "user-1",
			trigger: "submit-message",
			workspaceId: "workspace-1",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			throw new Error("Expected Assistant Run input preparation to succeed.");
		}
		const completed = await result.complete(createCompletionInput());
		expect(completed.chatMessages.map(({ id }) => id)).toEqual([
			"user-0",
			"user-1-edited",
		]);
		expect(events).toEqual(["snapshot", "branch", "context"]);
		expect(latency).toEqual([
			["convex.messages_loaded", { messageCount: 2 }],
			["chat.context_prepared", { compactionCount: 0, messageCount: 1 }],
			[
				"chat.branch_ready",
				{ incomingMessageCount: 2, shouldCreateChatBranch: true },
			],
		]);
	});

	it("uses the prepared context directly for ordinary input", async () => {
		const events: string[] = [];
		const result = await prepareHostedAssistantRunInput({
			branchFromMessage: async () => {
				throw new Error("ordinary input must not branch");
			},
			chatId: "chat-1",
			contextWindow: idleContextWindow(async () => {
				events.push("context");
				return {
					compaction: null,
					hasMoreMessages: false,
					messages: [],
				};
			}),
			getMessagesSnapshot: async () => {
				throw new Error("ordinary input must not load a branch snapshot");
			},
			listRunEventsAfter: async () => [],
			message: {
				id: "user-1",
				role: "user",
				parts: [{ type: "text", text: "Hello" }],
			},
			trigger: "submit-message",
			workspaceId: "workspace-1",
		});

		expect(result.ok).toBe(true);
		expect(events).toEqual(["context"]);
	});

	it("stops before context preparation when the route handles a branch error", async () => {
		let contextLoaded = false;
		const result = await prepareHostedAssistantRunInput({
			branchFromMessage: async () => {
				throw new Error("branch failed");
			},
			chatId: "chat-1",
			contextWindow: idleContextWindow(async () => {
				contextLoaded = true;
				return {
					compaction: null,
					hasMoreMessages: false,
					messages: [],
				};
			}),
			getMessagesSnapshot: async () => [
				storedMessage({ id: "user-1", role: "user", text: "Original" }),
			],
			listRunEventsAfter: async () => [],
			message: {
				id: "user-1-edited",
				role: "user",
				parts: [{ type: "text", text: "Edited" }],
			},
			messageId: "user-1",
			onBranchError: () => true,
			trigger: "submit-message",
			workspaceId: "workspace-1",
		});

		expect(result).toEqual({
			ok: false,
			reason: "branch_error_handled",
		});
		expect(contextLoaded).toBe(false);
	});
});
