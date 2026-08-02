import type { HostedChatContextMessage } from "@workspace/ai/chat-context-contract";
import type { ChatLatencyLogger } from "@workspace/ai/chat-latency-logger";
import type { ConvexHttpClient } from "convex/browser";
import { type FunctionReference, getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { prepareServerChatContextWindow } from "../server/chat-context-window";

const hostedChatTurnMock = vi.hoisted(() => ({
	prepareContextWindow: vi.fn(),
}));

vi.mock("@workspace/ai/hosted-chat-turn", () => ({
	prepareHostedChatContextWindow: hostedChatTurnMock.prepareContextWindow,
}));

const workspaceId = "workspace-1" as Id<"workspaces">;
const contextMessage: HostedChatContextMessage = {
	id: "message-1",
	role: "user",
	partsJson: JSON.stringify([{ type: "text", text: "Earlier message" }]),
	createdAt: 1_000,
	creationTime: 1_000,
};

describe("prepareServerChatContextWindow", () => {
	beforeEach(() => {
		hostedChatTurnMock.prepareContextWindow.mockReset();
	});

	it("threads one activity through an atomic compaction advance", async () => {
		const events: string[] = [];
		const query = vi.fn(
			async (functionReference: FunctionReference<"query">) => {
				events.push(getFunctionName(functionReference));
				return {
					compaction: null,
					hasMoreMessages: true,
					messages: [contextMessage],
				};
			},
		);
		const mutation = vi.fn(
			async (
				functionReference: FunctionReference<"mutation">,
				_args: Record<string, unknown>,
			) => {
				const functionName = getFunctionName(functionReference);
				events.push(functionName);
				return functionName === "chatContextCompactions:save"
					? {
							compaction: {
								summary: "Earlier context",
								throughCreationTime: contextMessage.creationTime,
								throughMessageId: contextMessage.id,
								updatedAt: 2_000,
							},
							hasMoreMessages: false,
							messages: [],
						}
					: null;
			},
		);
		hostedChatTurnMock.prepareContextWindow.mockImplementation(
			async ({
				compactionLifecycle,
				loadState,
				saveCompaction,
			}: {
				compactionLifecycle: {
					start: () => Promise<unknown>;
					cancel: () => Promise<unknown>;
				};
				loadState: () => Promise<{
					compaction: null;
					hasMoreMessages: boolean;
					messages: HostedChatContextMessage[];
				}>;
				saveCompaction: (args: {
					summary: string;
					throughCreationTime: number;
					throughMessageId: string;
				}) => Promise<unknown>;
			}) => {
				await expect(loadState()).resolves.toMatchObject({
					hasMoreMessages: true,
				});
				await compactionLifecycle.start();
				events.push("prepare");
				await expect(
					saveCompaction({
						summary: "Earlier context",
						throughCreationTime: contextMessage.creationTime,
						throughMessageId: contextMessage.id,
					}),
				).resolves.toMatchObject({ hasMoreMessages: false });
				return {
					compactionCount: 1,
					compactionSummary: "Earlier context",
					messages: [],
				};
			},
		);
		const logLatency = vi.fn() as ChatLatencyLogger;

		await expect(
			prepareServerChatContextWindow({
				anchorMessageId: "current-user-message",
				chatId: "chat-1",
				convexClient: { mutation, query } as unknown as ConvexHttpClient,
				logLatency,
				safetyIdentifier: "owner-1",
				workspaceId,
			}),
		).resolves.toMatchObject({ compactionCount: 1 });

		expect(events).toEqual([
			"chatContextCompactions:getPreparationState",
			"chatContextCompactions:startActivity",
			"prepare",
			"chatContextCompactions:save",
		]);
		const startArgs = mutation.mock.calls[0]?.[1];
		const saveArgs = mutation.mock.calls[1]?.[1];
		expect(startArgs).toMatchObject({
			anchorMessageId: "current-user-message",
			chatId: "chat-1",
			workspaceId,
		});
		expect(saveArgs).toMatchObject({
			activityId: startArgs?.activityId,
			chatId: "chat-1",
			workspaceId,
		});
	});

	it("exposes cancellation for the matching running activity", async () => {
		const mutation = vi.fn(
			async (
				_functionReference: FunctionReference<"mutation">,
				_args: Record<string, unknown>,
			) => null,
		);
		const query = vi.fn(
			async (_functionReference: FunctionReference<"query">) => ({
				compaction: null,
				hasMoreMessages: true,
				messages: [contextMessage],
			}),
		);
		hostedChatTurnMock.prepareContextWindow.mockImplementation(
			async ({
				compactionLifecycle,
			}: {
				compactionLifecycle: {
					start: () => Promise<unknown>;
					cancel: () => Promise<unknown>;
				};
			}) => {
				await compactionLifecycle.start();
				await compactionLifecycle.cancel();
				throw new Error("summary failed");
			},
		);

		await expect(
			prepareServerChatContextWindow({
				anchorMessageId: "current-user-message",
				chatId: "chat-1",
				convexClient: { mutation, query } as unknown as ConvexHttpClient,
				logLatency: vi.fn() as ChatLatencyLogger,
				safetyIdentifier: "owner-1",
				workspaceId,
			}),
		).rejects.toThrow("summary failed");

		expect(
			mutation.mock.calls.map(([functionReference]) =>
				getFunctionName(functionReference),
			),
		).toEqual([
			"chatContextCompactions:startActivity",
			"chatContextCompactions:cancelActivity",
		]);
		expect(mutation.mock.calls[1]?.[1]).toMatchObject({
			activityId: mutation.mock.calls[0]?.[1].activityId,
		});
	});
});
