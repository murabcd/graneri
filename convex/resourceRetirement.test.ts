import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
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
			role: "startup-generalist",
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
			await ctx.db.insert("chatMessages", {
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

test("note retirement owns linked chat continuation and is idempotent", async () => {
	vi.useFakeTimers();
	const { t, workspaceId } = await createWorkspace();
	const { chatIds, noteId } = await t.run(async (ctx) => {
		const noteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier,
			workspaceId,
			starredSortOrder: 0,
			title: "Retired note",
			content: "Body",
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
