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
		for (let index = 1; index <= 201; index += 1) {
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
		asOwner.query(api.chatContextCompactions.getDisplayState, {
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
	await expect(
		asOwner.mutation(api.chatContextCompactions.save, {
			workspaceId,
			chatId: "chat-context",
			summary: "Invalid skipped boundary.",
			throughCreationTime: skippedBoundary.creationTime,
			throughMessageId: skippedBoundary.id,
		}),
	).rejects.toThrow("Chat context compaction boundary is invalid.");

	await asOwner.mutation(api.chatContextCompactions.save, {
		workspaceId,
		chatId: "chat-context",
		summary: "Messages 1 through 100 summarized.",
		throughCreationTime: boundary.creationTime,
		throughMessageId: boundary.id,
	});
	await expect(
		asOwner.query(api.chatContextCompactions.getDisplayState, {
			workspaceId,
			chatId: "chat-context",
		}),
	).resolves.toEqual({ throughMessageId: "message-100" });

	const prepared = await asOwner.query(
		api.chatContextCompactions.getPreparationState,
		{ workspaceId, chatId: "chat-context" },
	);
	expect(prepared).toMatchObject({
		compaction: {
			summary: "Messages 1 through 100 summarized.",
			throughMessageId: "message-100",
		},
		hasMoreMessages: false,
	});
	expect(prepared.messages).toHaveLength(101);
	expect(prepared.messages[0]?.id).toBe("message-101");

	const storedCompaction = await t.run(async (ctx) =>
		ctx.db
			.query("chatContextCompactions")
			.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
			.unique(),
	);
	expect(storedCompaction?.ownerTokenIdentifier).toBe(
		ownerIdentity.tokenIdentifier,
	);

	await asOwner.mutation(api.chats.remove, {
		workspaceId,
		chatId: "chat-context",
	});
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	const deletedCompaction = await t.run(async (ctx) =>
		ctx.db
			.query("chatContextCompactions")
			.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
			.unique(),
	);
	expect(deletedCompaction).toBeNull();
});
