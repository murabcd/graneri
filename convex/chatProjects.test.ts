import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { PROJECT_NOTE_READ_CHUNK_LENGTH } from "@workspace/ai/project-note-tools";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

const otherIdentity = {
	...ownerIdentity,
	subject: "other-subject",
	tokenIdentifier: "test|other",
	email: "other@example.com",
};

const createFixture = async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const asOther = t.withIdentity(otherIdentity);
	const { ownerWorkspaceId, otherWorkspaceId } = await t.run(async (ctx) => ({
		ownerWorkspaceId: await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Owner workspace",
			normalizedName: "owner workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
		otherWorkspaceId: await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: otherIdentity.tokenIdentifier,
			name: "Other workspace",
			normalizedName: "other workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	}));
	const projectId = (
		await asOwner.mutation(api.projects.create, {
			workspaceId: ownerWorkspaceId,
			name: "Research",
		})
	)._id;
	const secondProjectId = (
		await asOwner.mutation(api.projects.create, {
			workspaceId: ownerWorkspaceId,
			name: "Product",
		})
	)._id;
	const otherProjectId = (
		await asOther.mutation(api.projects.create, {
			workspaceId: otherWorkspaceId,
			name: "Private",
		})
	)._id;

	return {
		asOther,
		asOwner,
		otherProjectId,
		otherWorkspaceId,
		ownerWorkspaceId,
		projectId,
		secondProjectId,
		t,
	};
};

const saveMessage = async ({
	asOwner,
	chatId,
	messageId,
	projectId,
	workspaceId,
}: {
	asOwner: Awaited<ReturnType<typeof createFixture>>["asOwner"];
	chatId: string;
	messageId: string;
	projectId: Id<"projects"> | null;
	workspaceId: Id<"workspaces">;
}) =>
	await asOwner.mutation(api.chats.saveMessage, {
		projectId,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId,
		message: {
			id: messageId,
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: messageId }]),
			text: messageId,
			createdAt: 2_000,
		},
	});

test("chat project ownership is explicit, persisted, and updated with accepted turns", async () => {
	const {
		asOwner,
		otherProjectId,
		ownerWorkspaceId,
		projectId,
		secondProjectId,
	} = await createFixture();

	await saveMessage({
		asOwner,
		workspaceId: ownerWorkspaceId,
		chatId: "project-chat",
		messageId: "first",
		projectId,
	});
	await expect(
		asOwner.query(api.chats.getSession, {
			workspaceId: ownerWorkspaceId,
			chatId: "project-chat",
		}),
	).resolves.toMatchObject({ projectId });

	await saveMessage({
		asOwner,
		workspaceId: ownerWorkspaceId,
		chatId: "project-chat",
		messageId: "second",
		projectId: secondProjectId,
	});
	await expect(
		asOwner.query(api.chats.getSession, {
			workspaceId: ownerWorkspaceId,
			chatId: "project-chat",
		}),
	).resolves.toMatchObject({ projectId: secondProjectId });

	await saveMessage({
		asOwner,
		workspaceId: ownerWorkspaceId,
		chatId: "workspace-chat",
		messageId: "first",
		projectId: null,
	});
	await expect(
		asOwner.query(api.chats.getSession, {
			workspaceId: ownerWorkspaceId,
			chatId: "workspace-chat",
		}),
	).resolves.toMatchObject({ projectId: null });

	await expect(
		saveMessage({
			asOwner,
			workspaceId: ownerWorkspaceId,
			chatId: "unauthorized-project-chat",
			messageId: "first",
			projectId: otherProjectId,
		}),
	).rejects.toThrow("You do not have access to this project");
});

test("existing chat project changes are authorized and forks copy the project", async () => {
	const {
		asOwner,
		otherProjectId,
		ownerWorkspaceId,
		projectId,
		secondProjectId,
	} = await createFixture();
	await saveMessage({
		asOwner,
		workspaceId: ownerWorkspaceId,
		chatId: "source-chat",
		messageId: "user-1",
		projectId,
	});
	await asOwner.mutation(api.chats.saveMessage, {
		projectId,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId: ownerWorkspaceId,
		chatId: "source-chat",
		message: {
			id: "assistant-1",
			role: "assistant",
			partsJson: JSON.stringify([{ type: "text", text: "Answer" }]),
			text: "Answer",
			createdAt: 2_001,
		},
	});

	await expect(
		asOwner.mutation(api.chats.setProject, {
			workspaceId: ownerWorkspaceId,
			chatId: "source-chat",
			projectId: otherProjectId,
		}),
	).rejects.toThrow("You do not have access to this project");
	await expect(
		asOwner.mutation(api.chats.setProject, {
			workspaceId: ownerWorkspaceId,
			chatId: "source-chat",
			projectId: secondProjectId,
		}),
	).resolves.toEqual({ projectId: secondProjectId });

	await asOwner.mutation(api.chatThreads.forkFromAssistantMessage, {
		workspaceId: ownerWorkspaceId,
		chatId: "source-chat",
		messageId: "assistant-1",
		forkChatId: "fork-chat",
	});
	await expect(
		asOwner.query(api.chats.getSession, {
			workspaceId: ownerWorkspaceId,
			chatId: "fork-chat",
		}),
	).resolves.toMatchObject({ projectId: secondProjectId });
});

test("project note tools search and read only the persisted chat project", async () => {
	const { asOther, asOwner, ownerWorkspaceId, projectId, secondProjectId, t } =
		await createFixture();
	await saveMessage({
		asOwner,
		workspaceId: ownerWorkspaceId,
		chatId: "research-chat",
		messageId: "first",
		projectId,
	});
	const { firstNoteId, secondNoteId, unrelatedNoteId } = await t.run(
		async (ctx) => {
			const createNote = async (
				noteProjectId: Id<"projects">,
				title: string,
				searchableText: string,
			) =>
				await ctx.db.insert("notes", {
					ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
					workspaceId: ownerWorkspaceId,
					projectId: noteProjectId,
					isStarred: false,
					starredSortOrder: 1_000,
					title,
					content: JSON.stringify({ type: "doc", content: [] }),
					searchableText,
					visibility: "private",
					isArchived: false,
					createdAt: 1_000,
					updatedAt: 1_000,
				});
			return {
				firstNoteId: await createNote(
					projectId,
					"Roadmap alpha",
					"The project roadmap launches in September.",
				),
				secondNoteId: await createNote(
					projectId,
					"Roadmap beta",
					"A second roadmap covers reliability work.",
				),
				unrelatedNoteId: await createNote(
					secondProjectId,
					"Roadmap secret",
					"This belongs to another project.",
				),
			};
		},
	);

	const result = await asOwner.query(api.chatProjectNotes.search, {
		workspaceId: ownerWorkspaceId,
		chatId: "research-chat",
		searchQuery: "roadmap",
		limit: 1,
	});
	expect(result.hasMore).toBe(true);
	expect(result.notes).toHaveLength(1);
	expect([firstNoteId, secondNoteId]).toContain(result.notes[0]?.id);
	expect(result.notes[0]?.preview.length).toBeLessThanOrEqual(500);

	await expect(
		asOwner.query(api.chatProjectNotes.get, {
			workspaceId: ownerWorkspaceId,
			chatId: "research-chat",
			noteId: firstNoteId,
		}),
	).resolves.toMatchObject({
		id: firstNoteId,
		title: "Roadmap alpha",
		text: "The project roadmap launches in September.",
	});
	await expect(
		asOwner.query(api.chatProjectNotes.get, {
			workspaceId: ownerWorkspaceId,
			chatId: "research-chat",
			noteId: unrelatedNoteId,
		}),
	).resolves.toBeNull();
	await expect(
		asOther.query(api.chatProjectNotes.search, {
			workspaceId: ownerWorkspaceId,
			chatId: "research-chat",
			searchQuery: "roadmap",
		}),
	).rejects.toThrow("Workspace not found");
	await expect(
		t.query(internal.chatProjectNotes.getForOwner, {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: ownerWorkspaceId,
			chatId: "research-chat",
			noteId: unrelatedNoteId,
		}),
	).resolves.toBeNull();
});

test("project note reads expose an explicit continuation offset", async () => {
	const { asOwner, ownerWorkspaceId, projectId, t } = await createFixture();
	await saveMessage({
		asOwner,
		workspaceId: ownerWorkspaceId,
		chatId: "long-note-chat",
		messageId: "first",
		projectId,
	});
	const noteText = `${"a".repeat(PROJECT_NOTE_READ_CHUNK_LENGTH)}remaining`;
	const noteId = await t.run(
		async (ctx) =>
			await ctx.db.insert("notes", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId: ownerWorkspaceId,
				projectId,
				isStarred: false,
				starredSortOrder: 1_000,
				title: "Long note",
				content: JSON.stringify({ type: "doc", content: [] }),
				searchableText: noteText,
				visibility: "private",
				isArchived: false,
				createdAt: 1_000,
				updatedAt: 1_000,
			}),
	);

	const firstChunk = await asOwner.query(api.chatProjectNotes.get, {
		workspaceId: ownerWorkspaceId,
		chatId: "long-note-chat",
		noteId,
	});
	expect(firstChunk?.text).toHaveLength(PROJECT_NOTE_READ_CHUNK_LENGTH);
	expect(firstChunk?.nextOffset).toBe(PROJECT_NOTE_READ_CHUNK_LENGTH);

	await expect(
		asOwner.query(api.chatProjectNotes.get, {
			workspaceId: ownerWorkspaceId,
			chatId: "long-note-chat",
			noteId,
			offset: firstChunk?.nextOffset ?? undefined,
		}),
	).resolves.toMatchObject({ text: "remaining", nextOffset: null });
});

test("removing a project clears it from active and archived chats", async () => {
	const { asOwner, ownerWorkspaceId, projectId, t } = await createFixture();
	await saveMessage({
		asOwner,
		workspaceId: ownerWorkspaceId,
		chatId: "active-chat",
		messageId: "first",
		projectId,
	});
	await saveMessage({
		asOwner,
		workspaceId: ownerWorkspaceId,
		chatId: "archived-chat",
		messageId: "first",
		projectId,
	});
	await asOwner.mutation(api.chats.moveToTrash, {
		workspaceId: ownerWorkspaceId,
		chatId: "archived-chat",
	});

	await asOwner.mutation(api.projects.remove, {
		workspaceId: ownerWorkspaceId,
		id: projectId,
	});
	const chats = await t.run(
		async (ctx) =>
			await ctx.db
				.query("chats")
				.withIndex(
					"by_ownerTokenIdentifier_and_workspaceId_and_updatedAt",
					(q) =>
						q
							.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
							.eq("workspaceId", ownerWorkspaceId),
				)
				.take(10),
	);
	expect(chats.map((chat) => chat.projectId)).toEqual([null, null]);
});
