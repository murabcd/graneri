import { CHAT_MODE } from "@workspace/ai/chat-mode";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { describe, expect, it } from "vitest";
import {
	createQueuedUserMessageId,
	fromQueuedUserMessage,
	getQueuedChatComposerEditDraft,
	toQueuedUserMessageInput,
} from "@/lib/chat-queue";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	applyQueuedFollowUpChange,
	getQueuedFollowUpCacheKey,
	type QueuedFollowUpMessage,
	readQueuedFollowUpsCache,
	reconcileQueuedFollowUpsCache,
	resetQueuedFollowUpsCacheForTest,
	subscribeQueuedFollowUpsCache,
} from "../src/lib/chat-queued-followups";

const workspaceId = "workspace-1" as Id<"workspaces">;

const createQueuedFollowUp = (
	id: string,
	overrides: Partial<QueuedFollowUpMessage> = {},
): QueuedFollowUpMessage =>
	({
		_id: id as Id<"assistantQueuedMessages">,
		_creationTime: 1,
		chatId: "chat-1",
		createdAt: 1,
		messageId: id,
		metadataJson: undefined,
		requestBodyJson: "{}",
		runId: "run-1" as Id<"assistantRuns">,
		text: `message ${id}`,
		workspaceId,
		...overrides,
	}) as QueuedFollowUpMessage;

describe("chat queue serialization", () => {
	it("persists an opaque local capability without its Electron-owned path", () => {
		const queuedMessage = toQueuedUserMessageInput({
			requestBody: {
				...DEFAULT_CHAT_SETTINGS,
				convexToken: "token",
				projectId: null,
				localCapabilitySession: {
					id: "capability-1",
					label: "Documents",
				},
				timezone: "UTC",
			},
			text: "Use this folder next",
		});

		expect(JSON.parse(queuedMessage.requestBodyJson)).toMatchObject({
			localCapabilitySession: {
				id: "capability-1",
				label: "Documents",
			},
		});
		expect(queuedMessage.requestBodyJson).not.toContain("/Users/");
	});

	it("persists only replay-owned request state", () => {
		const queuedMessage = toQueuedUserMessageInput({
			requestBody: {
				chatMode: CHAT_MODE.PLAN,
				convexToken: "token",
				localCapabilitySession: null,
				mentions: ["note-1"],
				model: DEFAULT_CHAT_SETTINGS.model,
				reasoningEffort: "high",
				replayQueuedMessageId: "stale-replay",
				projectId: "project-1",
				selectedSourceIds: ["source-1"],
				serviceTier: "priority",
				timezone: "UTC",
				webSearchEnabled: true,
				workspaceId: "workspace-1",
			},
			text: "Follow up",
		});

		expect(JSON.parse(queuedMessage.requestBodyJson)).toEqual({
			chatMode: CHAT_MODE.PLAN,
			localCapabilitySession: null,
			mentions: ["note-1"],
			model: DEFAULT_CHAT_SETTINGS.model,
			projectId: "project-1",
			reasoningEffort: "high",
			selectedSourceIds: ["source-1"],
			serviceTier: "priority",
			timezone: "UTC",
			webSearchEnabled: true,
		});
	});

	it("canonicalizes queued text before it crosses the durable replay boundary", () => {
		const queuedMessage = toQueuedUserMessageInput({
			requestBody: {
				...DEFAULT_CHAT_SETTINGS,
				convexToken: "token",
				projectId: null,
				localCapabilitySession: null,
				timezone: "UTC",
			},
			text: "  Follow   this\n\nup  ",
		});

		expect(queuedMessage.text).toBe("Follow this up");
	});

	it("reconstructs a recipe-only queued draft from exact typed metadata", () => {
		expect(
			getQueuedChatComposerEditDraft({
				metadataJson: JSON.stringify({
					recipe: { slug: "write-prd", name: "Write PRD" },
					recipeOnly: true,
				}),
				text: "Write PRD",
			}),
		).toEqual({
			text: "@Write PRD",
			mentions: [
				{
					id: "write-prd",
					label: "Write PRD",
					from: 0,
					to: 10,
					type: "recipe",
				},
			],
		});
	});

	it("rejects queued mention metadata without an exact mention kind", () => {
		expect(() =>
			getQueuedChatComposerEditDraft({
				metadataJson: JSON.stringify({
					mentionPositions: [
						{
							id: "app:notion",
							label: "Notion",
							from: 0,
							to: 7,
						},
					],
				}),
				text: "@Notion",
			}),
		).toThrow("Queued chat message metadata is invalid.");
	});

	it("rejects empty queued message text", () => {
		expect(() =>
			toQueuedUserMessageInput({
				requestBody: {
					...DEFAULT_CHAT_SETTINGS,
					convexToken: "token",
					projectId: null,
					localCapabilitySession: null,
					timezone: "UTC",
				},
				text: "   ",
			}),
		).toThrow("Queued chat message cannot be empty.");
	});

	it("stores only the note id for persisted note context", () => {
		const queuedMessage = toQueuedUserMessageInput({
			requestBody: {
				...DEFAULT_CHAT_SETTINGS,
				convexToken: "token",
				projectId: null,
				localCapabilitySession: null,
				noteContext: {
					noteId: "note-1",
					title: "Meeting",
					text: "Large note body",
				},
				recipeSlug: "summary",
			},
			text: "Follow up",
		});

		expect(JSON.parse(queuedMessage.requestBodyJson).noteContext).toEqual({
			noteId: "note-1",
		});
		expect(JSON.parse(queuedMessage.requestBodyJson).recipeSlug).toBe(
			"summary",
		);
	});

	it("bounds unsaved note context before durable queue persistence", () => {
		const queuedMessage = toQueuedUserMessageInput({
			requestBody: {
				...DEFAULT_CHAT_SETTINGS,
				convexToken: "token",
				projectId: null,
				localCapabilitySession: null,
				noteContext: {
					noteId: null,
					title: "t".repeat(20_000),
					text: "n".repeat(20_000),
				},
			},
			text: "Follow up",
		});

		const noteContext = JSON.parse(queuedMessage.requestBodyJson).noteContext;
		expect(noteContext.noteId).toBeNull();
		expect(noteContext.title).toHaveLength(16_000);
		expect(noteContext.text).toHaveLength(16_000);
	});

	it("restores queued request state with a fresh Convex token", async () => {
		const queuedMessage = toQueuedUserMessageInput({
			metadata: {
				recipe: { name: "Review", slug: "review" },
				recipeOnly: false,
			},
			requestBody: {
				...DEFAULT_CHAT_SETTINGS,
				convexToken: "stale-token",
				projectId: null,
				localCapabilitySession: null,
				timezone: "UTC",
			},
			text: "Follow up",
		});

		const prepared = await fromQueuedUserMessage({
			queuedMessage: {
				...queuedMessage,
				_id: "queued-message-1",
				status: "queued",
				workspaceId,
			},
			resolveConvexToken: async () => "fresh-token",
		});

		expect(prepared.body).toMatchObject({
			convexToken: "fresh-token",
			model: DEFAULT_CHAT_SETTINGS.model,
			replayQueuedMessageId: "queued-message-1",
			replayQueuedMessageStatus: "queued",
			workspaceId,
		});
		expect(prepared.message.messageId).toBeUndefined();
		expect(prepared.message.metadata).toEqual({
			recipe: { name: "Review", slug: "review" },
			recipeOnly: false,
		});
		expect(prepared.message.text).toBe("Follow up");
	});

	it("rejects queued request replay without a fresh Convex token", async () => {
		const queuedMessage = toQueuedUserMessageInput({
			requestBody: {
				...DEFAULT_CHAT_SETTINGS,
				convexToken: "stale-token",
				localCapabilitySession: null,
				projectId: null,
				timezone: "UTC",
			},
			text: "Follow up",
		});

		await expect(
			fromQueuedUserMessage({
				queuedMessage: {
					...queuedMessage,
					_id: "queued-message-1",
					status: "queued",
					workspaceId,
				},
				resolveConvexToken: async () => null,
			}),
		).rejects.toThrow(
			"Cannot send queued chat message without a Convex token.",
		);
	});

	it("rejects queued request replay without a durable queue id", async () => {
		const queuedMessage = toQueuedUserMessageInput({
			requestBody: {
				...DEFAULT_CHAT_SETTINGS,
				convexToken: "stale-token",
				localCapabilitySession: null,
				projectId: null,
				timezone: "UTC",
			},
			text: "Follow up",
		});

		await expect(
			fromQueuedUserMessage({
				queuedMessage: {
					...queuedMessage,
					_id: "",
					status: "queued",
					workspaceId,
				},
				resolveConvexToken: async () => "fresh-token",
			}),
		).rejects.toThrow("Queued chat message requires a durable queue id.");
	});

	it("preserves explicit queued message ids for edit replays", async () => {
		const queuedMessage = toQueuedUserMessageInput({
			messageId: "existing-user-message",
			requestBody: {
				...DEFAULT_CHAT_SETTINGS,
				convexToken: "stale-token",
				localCapabilitySession: null,
				projectId: null,
				timezone: "UTC",
			},
			text: "Edited follow up",
		});

		const prepared = await fromQueuedUserMessage({
			queuedMessage: {
				...queuedMessage,
				_id: "queued-message-1",
				status: "paused",
				workspaceId,
			},
			resolveConvexToken: async () => "fresh-token",
		});

		expect(prepared.message.messageId).toBe("existing-user-message");
		expect(prepared.message.text).toBe("Edited follow up");
		expect(prepared.body.replayQueuedMessageStatus).toBe("paused");
	});

	it("preserves generated queued message ids when they already exist locally", async () => {
		const messageId = createQueuedUserMessageId();
		const queuedMessage = toQueuedUserMessageInput({
			messageId,
			requestBody: {
				...DEFAULT_CHAT_SETTINGS,
				convexToken: "stale-token",
				localCapabilitySession: null,
				projectId: null,
				timezone: "UTC",
			},
			text: "Visible follow up",
		});

		const prepared = await fromQueuedUserMessage({
			hasMessageId: (candidateMessageId) => candidateMessageId === messageId,
			queuedMessage: {
				...queuedMessage,
				_id: "queued-message-1",
				status: "queued",
				workspaceId,
			},
			resolveConvexToken: async () => "fresh-token",
		});

		expect(prepared.message.messageId).toBe(messageId);
		expect(prepared.message.text).toBe("Visible follow up");
	});

	it("rejects invalid queued request body shapes at the boundary", async () => {
		await expect(
			fromQueuedUserMessage({
				queuedMessage: {
					_id: "queued-message-1",
					messageId: "queued-1",
					requestBodyJson: "[]",
					status: "queued",
					text: "Follow up",
					workspaceId,
				},
				resolveConvexToken: async () => "fresh-token",
			}),
		).rejects.toThrow("Queued chat request body is invalid.");
	});
});

describe("queued follow-up lifecycle", () => {
	it("scopes visible queued messages by workspace and chat", () => {
		resetQueuedFollowUpsCacheForTest();
		const cacheKey = getQueuedFollowUpCacheKey({
			chatId: "chat-1",
			workspaceId,
		});
		const otherCacheKey = getQueuedFollowUpCacheKey({
			chatId: "chat-2",
			workspaceId,
		});
		const queuedMessage = createQueuedFollowUp("queued-1");

		reconcileQueuedFollowUpsCache(cacheKey, [queuedMessage]);

		expect(readQueuedFollowUpsCache(cacheKey)).toEqual([queuedMessage]);
		expect(readQueuedFollowUpsCache(otherCacheKey)).toEqual([]);
	});

	it("notifies visible queue subscribers when cached messages change", () => {
		resetQueuedFollowUpsCacheForTest();
		const cacheKey = getQueuedFollowUpCacheKey({
			chatId: "chat-1",
			workspaceId,
		});
		let notificationCount = 0;
		const unsubscribe = subscribeQueuedFollowUpsCache(cacheKey, () => {
			notificationCount += 1;
		});

		reconcileQueuedFollowUpsCache(cacheKey, [
			createQueuedFollowUp("queued-1"),
			createQueuedFollowUp("queued-2"),
		]);
		applyQueuedFollowUpChange(cacheKey, {
			type: "hide",
			messageId: "queued-1",
		});
		unsubscribe();
		reconcileQueuedFollowUpsCache(cacheKey, []);

		expect(notificationCount).toBe(2);
		expect(readQueuedFollowUpsCache(cacheKey)).toEqual([]);
	});
});
