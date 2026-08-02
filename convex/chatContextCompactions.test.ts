import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
};

test("context compaction advances a verified chat message boundary", async () => {
	vi.useFakeTimers();
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const { chatId, workspaceId } = await t.run(async (ctx) => {
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		const chatId = await ctx.db.insert("chats", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: "chat-context",
			starredSortOrder: 0,
			title: "Context",
			preview: "",
			isArchived: false,
			createdAt: 1_000,
			updatedAt: 1_000,
			lastMessageAt: 1_000,
		});
		for (let index = 1; index <= 301; index += 1) {
			await ctx.db.insert("chatMessages", {
				chatId,
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				messageId: `message-${index}`,
				role: index % 2 === 0 ? "assistant" : "user",
				partsJson: JSON.stringify([{ type: "text", text: `content ${index}` }]),
				text: `content ${index}`,
				createdAt: 1_000 + index,
			});
		}
		return { chatId, workspaceId };
	});

	const initial = await asOwner.query(
		api.chatContextCompactions.getPreparationState,
		{ workspaceId, chatId: "chat-context" },
	);
	await expect(
		asOwner.query(api.chatContextCompactions.getActivity, {
			workspaceId,
			chatId: "chat-context",
		}),
	).resolves.toBeNull();
	expect(initial.hasMoreMessages).toBe(true);
	expect(initial.messages).toHaveLength(201);
	const boundary = initial.messages[99];
	if (!boundary) {
		throw new Error("Expected compaction boundary message.");
	}
	const skippedBoundary = initial.messages[100];
	if (!skippedBoundary) {
		throw new Error("Expected skipped compaction boundary message.");
	}
	await asOwner.mutation(api.chatContextCompactions.startActivity, {
		workspaceId,
		chatId: "chat-context",
		activityId: "activity-1",
		anchorMessageId: "current-user-message",
	});
	await expect(
		asOwner.query(api.chatContextCompactions.getActivity, {
			workspaceId,
			chatId: "chat-context",
		}),
	).resolves.toEqual({
		anchorMessageId: "current-user-message",
		status: "running",
	});
	await expect(
		asOwner.mutation(api.chatContextCompactions.startActivity, {
			workspaceId,
			chatId: "chat-context",
			activityId: "activity-2",
			anchorMessageId: "concurrent-user-message",
		}),
	).rejects.toThrow("Chat context compaction is already in progress.");
	await expect(
		asOwner.mutation(api.chatContextCompactions.save, {
			workspaceId,
			chatId: "chat-context",
			activityId: "activity-1",
			summary: "Invalid skipped boundary.",
			throughCreationTime: skippedBoundary.creationTime,
			throughMessageId: skippedBoundary.id,
		}),
	).rejects.toThrow("Chat context compaction boundary is invalid.");
	await expect(
		asOwner.mutation(api.chatContextCompactions.save, {
			workspaceId,
			chatId: "chat-context",
			activityId: "stale-activity",
			summary: "Stale activity summary.",
			throughCreationTime: boundary.creationTime,
			throughMessageId: boundary.id,
		}),
	).rejects.toThrow(
		"Chat context compaction activity changed during preparation.",
	);

	const firstPrepared = await asOwner.mutation(
		api.chatContextCompactions.save,
		{
			workspaceId,
			chatId: "chat-context",
			activityId: "activity-1",
			summary: "Messages 1 through 100 summarized.",
			throughCreationTime: boundary.creationTime,
			throughMessageId: boundary.id,
		},
	);
	expect(firstPrepared).toMatchObject({
		compaction: {
			summary: "Messages 1 through 100 summarized.",
			throughMessageId: "message-100",
		},
		hasMoreMessages: true,
	});
	expect(firstPrepared.messages).toHaveLength(201);
	expect(firstPrepared.messages[0]?.id).toBe("message-101");
	await expect(
		asOwner.query(api.chatContextCompactions.getActivity, {
			workspaceId,
			chatId: "chat-context",
		}),
	).resolves.toEqual({
		anchorMessageId: "current-user-message",
		status: "running",
	});

	const secondBoundary = firstPrepared.messages[99];
	if (!secondBoundary) {
		throw new Error("Expected second compaction boundary message.");
	}
	const prepared = await asOwner.mutation(api.chatContextCompactions.save, {
		workspaceId,
		chatId: "chat-context",
		activityId: "activity-1",
		expectedThroughCreationTime: boundary.creationTime,
		expectedThroughMessageId: boundary.id,
		summary: "Messages 1 through 200 summarized.",
		throughCreationTime: secondBoundary.creationTime,
		throughMessageId: secondBoundary.id,
	});
	await expect(
		asOwner.query(api.chatContextCompactions.getActivity, {
			workspaceId,
			chatId: "chat-context",
		}),
	).resolves.toEqual({
		anchorMessageId: "current-user-message",
		status: "completed",
	});

	expect(prepared).toMatchObject({
		compaction: {
			summary: "Messages 1 through 200 summarized.",
			throughMessageId: "message-200",
		},
		hasMoreMessages: false,
	});
	expect(prepared.messages).toHaveLength(101);
	expect(prepared.messages[0]?.id).toBe("message-201");

	const storedState = await t.run(async (ctx) =>
		ctx.db
			.query("chatContextStates")
			.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
			.unique(),
	);
	expect(storedState).toMatchObject({
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		kind: "completed",
		checkpoint: {
			summary: "Messages 1 through 200 summarized.",
			throughMessageId: "message-200",
		},
	});
	await asOwner.mutation(api.chatContextCompactions.startActivity, {
		workspaceId,
		chatId: "chat-context",
		activityId: "cancelled-after-checkpoint",
		anchorMessageId: "current-user-message-2",
	});
	await asOwner.mutation(api.chatContextCompactions.cancelActivity, {
		workspaceId,
		chatId: "chat-context",
		activityId: "cancelled-after-checkpoint",
	});
	await expect(
		asOwner.query(api.chatContextCompactions.getPreparationState, {
			workspaceId,
			chatId: "chat-context",
		}),
	).resolves.toMatchObject({
		compaction: {
			summary: "Messages 1 through 200 summarized.",
			throughMessageId: "message-200",
		},
	});
	const checkpointState = await t.run(async (ctx) =>
		ctx.db
			.query("chatContextStates")
			.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
			.unique(),
	);
	expect(checkpointState?.kind).toBe("checkpoint");

	await asOwner.mutation(api.chats.remove, {
		workspaceId,
		chatId: "chat-context",
	});
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	const deletedState = await t.run(async (ctx) =>
		ctx.db
			.query("chatContextStates")
			.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
			.unique(),
	);
	expect(deletedState).toBeNull();
});

test("context compaction activity is cancelled or expires without a completed marker", async () => {
	vi.useFakeTimers();
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const workspaceId = await t.run(async (ctx) => {
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		await ctx.db.insert("chats", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: "chat-activity-cleanup",
			starredSortOrder: 0,
			title: "Context",
			preview: "",
			isArchived: false,
			createdAt: 1_000,
			updatedAt: 1_000,
			lastMessageAt: 1_000,
		});
		return workspaceId;
	});

	await asOwner.mutation(api.chatContextCompactions.startActivity, {
		workspaceId,
		chatId: "chat-activity-cleanup",
		activityId: "cancelled-activity",
		anchorMessageId: "message-1",
	});
	await asOwner.mutation(api.chatContextCompactions.cancelActivity, {
		workspaceId,
		chatId: "chat-activity-cleanup",
		activityId: "cancelled-activity",
	});
	await expect(
		asOwner.query(api.chatContextCompactions.getActivity, {
			workspaceId,
			chatId: "chat-activity-cleanup",
		}),
	).resolves.toBeNull();

	await asOwner.mutation(api.chatContextCompactions.startActivity, {
		workspaceId,
		chatId: "chat-activity-cleanup",
		activityId: "abandoned-activity",
		anchorMessageId: "message-2",
	});
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	await expect(
		asOwner.query(api.chatContextCompactions.getActivity, {
			workspaceId,
			chatId: "chat-activity-cleanup",
		}),
	).resolves.toBeNull();
});
