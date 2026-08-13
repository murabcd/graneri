import type { ChatLatencyLogger } from "@workspace/ai/chat-latency-logger";
import type { prepareHostedAssistantRunInput } from "@workspace/ai/hosted-chat-turn";
import { ConvexHttpClient } from "convex/browser";
import { type FunctionReference, getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { prepareServerAssistantRunInput } from "../server/chat-assistant-run-input";

const hostedChatTurnMock = vi.hoisted(() => ({
	prepareAssistantRunInput: vi.fn(),
}));

vi.mock("@workspace/ai/hosted-chat-turn", () => ({
	prepareHostedAssistantRunInput: hostedChatTurnMock.prepareAssistantRunInput,
}));

type AssistantRunInputArgs = Parameters<
	typeof prepareHostedAssistantRunInput
>[0];

const workspaceId = "workspace-1" as Id<"workspaces">;

describe("prepareServerAssistantRunInput", () => {
	beforeEach(() => {
		hostedChatTurnMock.prepareAssistantRunInput.mockReset();
	});

	it("maps Assistant Run input operations to the canonical Convex functions", async () => {
		const calls: Array<{ args: unknown; name: string }> = [];
		const query = vi.fn(
			async (functionReference: FunctionReference<"query">, args: unknown) => {
				const name = getFunctionName(functionReference);
				calls.push({ args, name });
				return name === "chatContextCompactions:getPreparationState"
					? { compaction: null, hasMoreMessages: false, messages: [] }
					: [];
			},
		);
		const mutation = vi.fn(
			async (
				functionReference: FunctionReference<"mutation">,
				args: unknown,
			) => {
				calls.push({ args, name: getFunctionName(functionReference) });
				return null;
			},
		);
		const convexClient = Object.assign(
			new ConvexHttpClient("https://example.convex.cloud"),
			{ mutation, query },
		);
		hostedChatTurnMock.prepareAssistantRunInput.mockImplementation(
			async (args: AssistantRunInputArgs) => {
				await args.getMessagesSnapshot({
					workspaceId: "workspace-1",
					chatId: "chat-1",
				});
				await args.listRunEventsAfter({ runId: "run-1", limit: 500 });
				await args.contextWindow.loadState();
				await args.contextWindow.compactionLifecycle.start();
				await args.contextWindow.saveCompaction({
					summary: "Earlier context",
					throughCreationTime: 1,
					throughMessageId: "message-1",
				});
				await args.contextWindow.compactionLifecycle.cancel();
				await args.branchFromMessage({
					workspaceId: "workspace-1",
					chatId: "chat-1",
					messageId: "message-1",
				});
				return { ok: true };
			},
		);

		await expect(
			prepareServerAssistantRunInput({
				anchorMessageId: "current-user-message",
				attachableRunId: "run-1" as Id<"assistantRuns">,
				chatId: "chat-1",
				continueRunId: "run-1" as Id<"assistantRuns">,
				convexClient,
				logLatency: vi.fn() as ChatLatencyLogger,
				message: {
					id: "current-user-message",
					role: "user",
					parts: [{ type: "text", text: "Edited" }],
				},
				messageId: "message-1",
				safetyIdentifier: "owner-1",
				trigger: "submit-message",
				workspaceId,
			}),
		).resolves.toEqual({ ok: true });

		expect(calls.map(({ name }) => name)).toEqual([
			"chats:getMessagesSnapshot",
			"assistantRunEvents:listRunEventsAfter",
			"chatContextCompactions:getPreparationState",
			"chatContextCompactions:startActivity",
			"chatContextCompactions:save",
			"chatContextCompactions:cancelActivity",
			"chatBranches:branchFromMessage",
		]);
		const activityCalls = calls.filter(({ name }) =>
			name.startsWith("chatContextCompactions:"),
		);
		const activityIds = activityCalls
			.map(({ args }) => args)
			.filter(
				(args): args is { activityId: string } =>
					typeof args === "object" &&
					args !== null &&
					"activityId" in args &&
					typeof args.activityId === "string",
			)
			.map(({ activityId }) => activityId);
		expect(new Set(activityIds).size).toBe(1);
		expect(activityCalls[1]?.args).toMatchObject({
			anchorMessageId: "current-user-message",
			chatId: "chat-1",
			workspaceId,
		});
	});
});
