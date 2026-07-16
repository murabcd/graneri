import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

afterEach(() => {
	vi.useRealTimers();
});

const createWorkspace = async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const workspaceId = await t.run((ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);
	return { asOwner, t, workspaceId };
};

test("chat thread pages expose complete history newest first", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await t.run(async (ctx) => {
		const chatId = await ctx.db.insert("chats", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: "long-chat",
			isStarred: false,
			starredSortOrder: 1_000,
			title: "Long chat",
			preview: "Message 204",
			isArchived: false,
			createdAt: 1_000,
			updatedAt: 2_204,
			lastMessageAt: 2_204,
		});
		for (let index = 0; index < 205; index += 1) {
			await ctx.db.insert("chatMessages", {
				chatId,
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				messageId: `message-${index}`,
				role: index % 2 === 0 ? "user" : "assistant",
				partsJson: JSON.stringify([{ type: "text", text: `Message ${index}` }]),
				text: `Message ${index}`,
				createdAt: 2_000 + index,
			});
		}
	});

	const firstPage = await asOwner.query(api.chatThreads.readPage, {
		workspaceId,
		chatId: "long-chat",
		paginationOpts: { cursor: null, numItems: 100 },
	});
	expect(firstPage.isDone).toBe(false);
	expect(firstPage.page).toHaveLength(100);
	expect(firstPage.page[0]?.id).toBe("message-204");
	expect(firstPage.page.at(-1)?.id).toBe("message-105");

	const secondPage = await asOwner.query(api.chatThreads.readPage, {
		workspaceId,
		chatId: "long-chat",
		paginationOpts: {
			cursor: firstPage.continueCursor,
			numItems: 100,
		},
	});
	expect(secondPage.isDone).toBe(false);
	expect(secondPage.page[0]?.id).toBe("message-104");

	const finalPage = await asOwner.query(api.chatThreads.readPage, {
		workspaceId,
		chatId: "long-chat",
		paginationOpts: {
			cursor: secondPage.continueCursor,
			numItems: 100,
		},
	});
	expect(finalPage.isDone).toBe(true);
	expect(finalPage.page.map((message) => message.id)).toEqual([
		"message-4",
		"message-3",
		"message-2",
		"message-1",
		"message-0",
	]);

	const fork = await asOwner.mutation(api.chatThreads.forkFromAssistantMessage, {
		workspaceId,
		chatId: "long-chat",
		messageId: "message-203",
		forkChatId: "bounded-fork",
	});
	expect(fork).toEqual({
		chatId: "bounded-fork",
		copiedMessageCount: 200,
		historyOmittedBefore: true,
	});
	await expect(
		asOwner.query(api.chats.getSession, {
			workspaceId,
			chatId: "bounded-fork",
		}),
	).resolves.toMatchObject({ historyOmittedBefore: true });
});

test("assistant message forks preserve source history and lineage", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	for (const message of [
		{ id: "user-1", role: "user" as const, text: "First prompt" },
		{ id: "assistant-1", role: "assistant" as const, text: "First answer" },
		{ id: "user-2", role: "user" as const, text: "Second prompt" },
		{ id: "assistant-2", role: "assistant" as const, text: "Second answer" },
	]) {
		await asOwner.mutation(api.chats.saveMessage, {
			workspaceId,
			chatId: "source-chat",
			preview: message.text,
			message: {
				id: message.id,
				role: message.role,
				partsJson: JSON.stringify([{ type: "text", text: message.text }]),
				text: message.text,
				createdAt: 2_000,
			},
		});
	}

	const result = await asOwner.mutation(
		api.chatThreads.forkFromAssistantMessage,
		{
			workspaceId,
			chatId: "source-chat",
			messageId: "assistant-1",
			forkChatId: "fork-chat",
		},
	);
	expect(result).toEqual({
		chatId: "fork-chat",
		copiedMessageCount: 2,
		historyOmittedBefore: false,
	});

	const [sourcePage, forkPage, forkSession] = await Promise.all([
		asOwner.query(api.chatThreads.readPage, {
			workspaceId,
			chatId: "source-chat",
			paginationOpts: { cursor: null, numItems: 10 },
		}),
		asOwner.query(api.chatThreads.readPage, {
			workspaceId,
			chatId: "fork-chat",
			paginationOpts: { cursor: null, numItems: 10 },
		}),
		asOwner.query(api.chats.getSession, {
			workspaceId,
			chatId: "fork-chat",
		}),
	]);
	expect(sourcePage.page).toHaveLength(4);
	expect(forkPage.page.map((message) => message.id)).toEqual([
		"assistant-1",
		"user-1",
	]);
	expect(forkSession).toMatchObject({
		forkedFromChatId: "source-chat",
		forkedFromMessageId: "assistant-1",
		historyOmittedBefore: false,
	});
});

test("chat forks reject user-message targets", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "source-chat",
		preview: "Prompt",
		message: {
			id: "user-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			text: "Prompt",
			createdAt: 2_000,
		},
	});

	await expect(
		asOwner.mutation(api.chatThreads.forkFromAssistantMessage, {
			workspaceId,
			chatId: "source-chat",
			messageId: "user-1",
			forkChatId: "fork-chat",
		}),
	).rejects.toThrow("stored assistant message");
});

test("forked chats retain shared attachments until the last chat is removed", async () => {
	vi.useFakeTimers();
	const { asOwner, t, workspaceId } = await createWorkspace();
	const storageId = await t.run((ctx) =>
		ctx.storage.store(new Blob(["attachment"], { type: "text/plain" })),
	);
	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "source-chat",
		preview: "Attachment",
		message: {
			id: "user-1",
			role: "user",
			partsJson: JSON.stringify([
				{
					type: "file",
					mediaType: "text/plain",
					filename: "attachment.txt",
					url: "https://example.test/attachment.txt",
					providerMetadata: { graneri: { storageId } },
				},
			]),
			text: "Attachment",
			createdAt: 2_000,
		},
	});
	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "source-chat",
		preview: "Answer",
		message: {
			id: "assistant-1",
			role: "assistant",
			partsJson: JSON.stringify([{ type: "text", text: "Answer" }]),
			text: "Answer",
			createdAt: 2_001,
		},
	});
	await asOwner.mutation(api.chatThreads.forkFromAssistantMessage, {
		workspaceId,
		chatId: "source-chat",
		messageId: "assistant-1",
		forkChatId: "fork-chat",
	});

	const referencesAfterFork = await t.run((ctx) =>
		ctx.db
			.query("chatAttachmentReferences")
			.withIndex("by_storageId", (q) => q.eq("storageId", storageId))
			.collect(),
	);
	expect(referencesAfterFork).toHaveLength(2);

	await asOwner.mutation(api.chats.remove, {
		workspaceId,
		chatId: "source-chat",
	});
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	expect(await t.run((ctx) => ctx.db.system.get(storageId))).not.toBeNull();

	await asOwner.mutation(api.chats.remove, {
		workspaceId,
		chatId: "fork-chat",
	});
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	expect(await t.run((ctx) => ctx.db.system.get(storageId))).toBeNull();
});
