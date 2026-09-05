import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { DEFAULT_CHAT_MODEL_ID } from "@workspace/ai/models";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { writeChatMessageContent } from "./chatMessageContent";
import { writeChatMessage } from "./chatMessagePersistence";
import { insertTestNote } from "./noteDocument.fixtures";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerTokenIdentifier = "test|retirement-owner";

afterEach(() => {
	vi.useRealTimers();
});

const createWorkspace = async () => {
	const t = convexTest(schema, modules);
	const workspaceId = await t.run(async (ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier,
			name: "Retirement workspace",
			normalizedName: "retirement-workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);

	return { t, workspaceId };
};

test("chat retirement reports progress and retries exact message batches", async () => {
	vi.useFakeTimers();
	const { t, workspaceId } = await createWorkspace();
	const chatId = await t.run(async (ctx) => {
		const chatId = await ctx.db.insert("chats", {
			projectId: null,
			...DEFAULT_CHAT_SETTINGS,
			ownerTokenIdentifier,
			workspaceId,
			chatId: "large-chat",
			starredSortOrder: 0,
			title: "Large chat",
			preview: "Large chat",
			isArchived: true,
			createdAt: 1_000,
			updatedAt: 1_000,
			lastMessageAt: 1_000,
		});

		for (let index = 0; index < 101; index += 1) {
			await writeChatMessage(ctx, {
				chatId,
				ownerTokenIdentifier,
				messageId: `message-${index}`,
				role: "user",
				partsJson: "[]",
				text: `Message ${index}`,
				createdAt: index,
			});
		}

		return chatId;
	});

	const progress = await t.mutation(internal.resourceRetirement.retireChat, {
		chatId,
	});

	expect(progress).toEqual({ retiredCount: 0, hasMore: true });
	expect(await t.run(async (ctx) => ctx.db.get(chatId))).not.toBeNull();

	await t.finishAllScheduledFunctions(vi.runAllTimers);

	const remaining = await t.run(async (ctx) => ({
		chat: await ctx.db.get(chatId),
		messages: await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chatId))
			.take(10),
	}));
	expect(remaining).toEqual({ chat: null, messages: [] });

	await expect(
		t.mutation(internal.resourceRetirement.retireChat, { chatId }),
	).resolves.toEqual({ retiredCount: 0, hasMore: false });
});

test("project automation cleanup continues after a bounded batch and is idempotent", async () => {
	vi.useFakeTimers();
	const { t, workspaceId } = await createWorkspace();
	const projectId = await t.run(async (ctx) => {
		const projectId = await ctx.db.insert("projects", {
			ownerTokenIdentifier,
			workspaceId,
			name: "Automation project",
			description: "",
			normalizedName: "automation project",
			icon: "folder",
			color: "default",
			isStarred: false,
			sortOrder: 0,
			starredSortOrder: 0,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		for (let index = 0; index < 101; index += 1) {
			await ctx.db.insert("automations", {
				ownerTokenIdentifier,
				workspaceId,
				projectId,
				title: `Automation ${index}`,
				prompt: "Review the project.",
				model: DEFAULT_CHAT_MODEL_ID,
				reasoningEffort: "medium",
				serviceTier: "auto",
				webSearchEnabled: false,
				appsEnabled: false,
				appSources: [],
				schedule: {
					kind: "once",
					at: 10_000 + index,
					timezone: "UTC",
				},
				targetKind: "workspace",
				targetLabel: "Workspace",
				destination: "standalone",
				deliveryPolicy: "always",
				chatId: `automation-${index}`,
				isPaused: true,
				isCompleted: false,
				createdAt: 1_000 + index,
				updatedAt: 1_000 + index,
			});
		}
		return projectId;
	});

	const progress = await t.mutation(
		internal.resourceRetirement.clearProjectAutomationRelationships,
		{ ownerTokenIdentifier, workspaceId, projectId },
	);
	expect(progress).toEqual({ clearedCount: 100, hasMore: true });

	const pendingCount = await t.run(
		async (ctx) =>
			(
				await ctx.db
					.query("automations")
					.withIndex("by_owner_workspace_project_updatedAt", (q) =>
						q
							.eq("ownerTokenIdentifier", ownerTokenIdentifier)
							.eq("workspaceId", workspaceId)
							.eq("projectId", projectId),
					)
					.take(2)
			).length,
	);
	expect(pendingCount).toBe(1);

	await t.finishAllScheduledFunctions(vi.runAllTimers);

	const remaining = await t.run(
		async (ctx) =>
			await ctx.db
				.query("automations")
				.withIndex("by_owner_workspace_project_updatedAt", (q) =>
					q
						.eq("ownerTokenIdentifier", ownerTokenIdentifier)
						.eq("workspaceId", workspaceId)
						.eq("projectId", projectId),
				)
				.take(1),
	);
	expect(remaining).toEqual([]);
	await expect(
		t.mutation(
			internal.resourceRetirement.clearProjectAutomationRelationships,
			{
				ownerTokenIdentifier,
				workspaceId,
				projectId,
			},
		),
	).resolves.toEqual({ clearedCount: 0, hasMore: false });
});

test("chat retirement deletes preserved branch messages and metadata", async () => {
	vi.useFakeTimers();
	const { t, workspaceId } = await createWorkspace();
	const { branchId, chatId } = await t.run(async (ctx) => {
		const chatId = await ctx.db.insert("chats", {
			projectId: null,
			...DEFAULT_CHAT_SETTINGS,
			ownerTokenIdentifier,
			workspaceId,
			chatId: "branched-chat",
			starredSortOrder: 0,
			title: "Branched chat",
			preview: "Current branch",
			isArchived: true,
			createdAt: 1_000,
			updatedAt: 1_000,
			lastMessageAt: 1_000,
		});
		const branchId = await ctx.db.insert("chatBranches", {
			ownerTokenIdentifier,
			workspaceId,
			chatId,
			forkedFromMessageId: "replaced-message",
			messageCount: 1,
			preview: "Replaced branch",
			createdAt: 1_100,
		});
		await ctx.db.insert("chatBranchMessages", {
			branchId,
			chatId,
			ownerTokenIdentifier,
			sequence: 0,
			messageId: "replaced-message",
			role: "assistant",
			contentId: await writeChatMessageContent(ctx, {
				partsJson: "[]",
				text: "Replaced branch",
			}),
			preview: "Replaced branch",
			createdAt: 1_050,
		});
		return { branchId, chatId };
	});

	const progress = await t.mutation(internal.resourceRetirement.retireChat, {
		chatId,
	});
	expect(progress).toEqual({ retiredCount: 0, hasMore: true });

	await t.finishAllScheduledFunctions(vi.runAllTimers);

	const remaining = await t.run(async (ctx) => ({
		branch: await ctx.db.get(branchId),
		branchMessages: await ctx.db
			.query("chatBranchMessages")
			.withIndex("by_branchId_and_sequence", (q) => q.eq("branchId", branchId))
			.collect(),
		chat: await ctx.db.get(chatId),
	}));
	expect(remaining).toEqual({
		branch: null,
		branchMessages: [],
		chat: null,
	});
});

test("note retirement owns linked chat continuation and is idempotent", async () => {
	vi.useFakeTimers();
	const { t, workspaceId } = await createWorkspace();
	const { chatIds, noteId } = await t.run(async (ctx) => {
		const noteId = await insertTestNote(ctx, {
			ownerTokenIdentifier,
			workspaceId,
			starredSortOrder: 0,
			title: "Retired note",
			searchableText: "Body",
			visibility: "private",
			isArchived: true,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		const chatIds = [];

		for (let index = 0; index < 26; index += 1) {
			chatIds.push(
				await ctx.db.insert("chats", {
					projectId: null,
					...DEFAULT_CHAT_SETTINGS,
					ownerTokenIdentifier,
					workspaceId,
					chatId: `note-chat-${index}`,
					noteId,
					starredSortOrder: 0,
					title: `Note chat ${index}`,
					preview: "",
					isArchived: true,
					createdAt: 1_000,
					updatedAt: index,
					lastMessageAt: index,
				}),
			);
		}

		return { chatIds, noteId };
	});

	await t.mutation(internal.resourceRetirement.retireNote, {
		ownerTokenIdentifier,
		workspaceId,
		noteId,
	});
	await t.finishAllScheduledFunctions(vi.runAllTimers);

	const remaining = await t.run(async (ctx) => ({
		chats: await Promise.all(chatIds.map((chatId) => ctx.db.get(chatId))),
		note: await ctx.db.get(noteId),
	}));
	expect(remaining.note).toBeNull();
	expect(remaining.chats.every((chat) => chat === null)).toBe(true);

	await expect(
		t.mutation(internal.resourceRetirement.retireNote, {
			ownerTokenIdentifier,
			workspaceId,
			noteId,
		}),
	).resolves.toBeNull();
});
