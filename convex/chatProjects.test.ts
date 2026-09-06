import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { NOTE_READ_CHUNK_LENGTH } from "@workspace/ai/note-tools";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { insertTestNote } from "./noteDocument.fixtures";
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

afterEach(() => {
	vi.useRealTimers();
});

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
				await insertTestNote(ctx, {
					ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
					workspaceId: ownerWorkspaceId,
					projectId: noteProjectId,
					isStarred: false,
					starredSortOrder: 1_000,
					title,
					content: JSON.stringify({
						type: "doc",
						content: [{ type: "paragraph" }],
					}),
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

	const result = await asOwner.query(api.chatNotes.search, {
		workspaceId: ownerWorkspaceId,
		chatId: "research-chat",
		searchQuery: "roadmap",
		limit: 1,
	});
	expect(result.hasMore).toBe(true);
	expect(result.notes).toHaveLength(1);
	expect([firstNoteId, secondNoteId]).toContain(result.notes[0]?.noteId);
	expect(result.notes[0]?.project).toEqual({
		projectId,
		name: "Research",
		description: "",
	});
	expect(result.notes[0]?.preview.length).toBeLessThanOrEqual(500);

	await expect(
		asOwner.query(api.chatNotes.get, {
			workspaceId: ownerWorkspaceId,
			chatId: "research-chat",
			noteId: firstNoteId,
		}),
	).resolves.toMatchObject({
		noteId: firstNoteId,
		title: "Roadmap alpha",
		project: { projectId, name: "Research", description: "" },
		text: "The project roadmap launches in September.",
	});
	await expect(
		asOwner.query(api.chatNotes.get, {
			workspaceId: ownerWorkspaceId,
			chatId: "research-chat",
			noteId: unrelatedNoteId,
		}),
	).resolves.toBeNull();
	await expect(
		asOther.query(api.chatNotes.search, {
			workspaceId: ownerWorkspaceId,
			chatId: "research-chat",
			searchQuery: "roadmap",
		}),
	).rejects.toThrow("Workspace not found");
	await expect(
		t.query(internal.chatNotes.getForOwner, {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: ownerWorkspaceId,
			chatId: "research-chat",
			noteId: unrelatedNoteId,
		}),
	).resolves.toBeNull();
});

test("workspace chats search and read unmentioned notes without crossing ownership or workspace boundaries", async () => {
	const { asOwner, ownerWorkspaceId, otherWorkspaceId, projectId, t } =
		await createFixture();
	await saveMessage({
		asOwner,
		workspaceId: ownerWorkspaceId,
		chatId: "workspace-search",
		messageId: "find-design",
		projectId: null,
	});
	const { rootNoteId, projectNoteId, excludedNoteIds } = await t.run(
		async (ctx) => {
			const createNote = (
				overrides: Partial<Parameters<typeof insertTestNote>[1]>,
			) =>
				insertTestNote(ctx, {
					ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
					workspaceId: ownerWorkspaceId,
					title: "Подход к дизайн-инжинирингу",
					searchableText: "Design critique and shared engineering practices.",
					visibility: "private",
					isArchived: false,
					isStarred: false,
					starredSortOrder: 1_000,
					createdAt: 1_000,
					updatedAt: 1_000,
					...overrides,
				});
			return {
				rootNoteId: await createNote({}),
				projectNoteId: await createNote({ projectId }),
				excludedNoteIds: [
					await createNote({ isArchived: true }),
					await createNote({ workspaceId: otherWorkspaceId }),
					await createNote({
						ownerTokenIdentifier: otherIdentity.tokenIdentifier,
					}),
				],
			};
		},
	);
	const scope = { workspaceId: ownerWorkspaceId, chatId: "workspace-search" };
	for (const searchQuery of ["дизайн", "design"]) {
		const result = await asOwner.query(api.chatNotes.search, {
			...scope,
			searchQuery,
		});
		expect(result.notes.map((note) => note.noteId).sort()).toEqual(
			[rootNoteId, projectNoteId].sort(),
		);
		expect(result.hasMore).toBe(false);
		expect(
			result.notes.find((note) => note.noteId === rootNoteId)?.project,
		).toBeNull();
		expect(
			result.notes.find((note) => note.noteId === projectNoteId)?.project,
		).toEqual({ projectId, name: "Research", description: "" });
		await expect(
			t.query(internal.chatNotes.searchForOwner, {
				...scope,
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				searchQuery,
			}),
		).resolves.toEqual(result);
	}
	await expect(
		asOwner.query(api.chatNotes.get, { ...scope, noteId: rootNoteId }),
	).resolves.toMatchObject({
		noteId: rootNoteId,
		project: null,
		text: "Design critique and shared engineering practices.",
	});
	for (const noteId of excludedNoteIds) {
		await expect(
			asOwner.query(api.chatNotes.get, { ...scope, noteId }),
		).resolves.toBeNull();
		await expect(
			t.query(internal.chatNotes.getForOwner, {
				...scope,
				noteId,
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			}),
		).resolves.toBeNull();
	}
	await t.run(async (ctx) => {
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("workspaceId", ownerWorkspaceId)
					.eq("chatId", scope.chatId),
			)
			.unique();
		if (!chat) throw new Error("Expected workspace chat");
		await ctx.db.patch(chat._id, { isArchived: true });
	});
	for (const chatId of ["missing-chat", "workspace-search"]) {
		await expect(
			asOwner.query(api.chatNotes.search, {
				...scope,
				chatId,
				searchQuery: "design",
			}),
		).resolves.toEqual({ hasMore: false, notes: [] });
		await expect(
			asOwner.query(api.chatNotes.get, {
				...scope,
				chatId,
				noteId: rootNoteId,
			}),
		).resolves.toBeNull();
	}
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
	const noteText = `${"a".repeat(NOTE_READ_CHUNK_LENGTH)}remaining`;
	const noteId = await t.run(
		async (ctx) =>
			await insertTestNote(ctx, {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId: ownerWorkspaceId,
				projectId,
				isStarred: false,
				starredSortOrder: 1_000,
				title: "Long note",
				content: JSON.stringify({
					type: "doc",
					content: [{ type: "paragraph" }],
				}),
				searchableText: noteText,
				visibility: "private",
				isArchived: false,
				createdAt: 1_000,
				updatedAt: 1_000,
			}),
	);

	const firstChunk = await asOwner.query(api.chatNotes.get, {
		workspaceId: ownerWorkspaceId,
		chatId: "long-note-chat",
		noteId,
	});
	expect(firstChunk?.text).toHaveLength(NOTE_READ_CHUNK_LENGTH);
	expect(firstChunk?.nextOffset).toBe(NOTE_READ_CHUNK_LENGTH);

	await expect(
		asOwner.query(api.chatNotes.get, {
			workspaceId: ownerWorkspaceId,
			chatId: "long-note-chat",
			noteId,
			offset: firstChunk?.nextOffset ?? undefined,
		}),
	).resolves.toMatchObject({ text: "remaining", nextOffset: null });
});

test("removing a project clears it from active and archived chats", async () => {
	vi.useFakeTimers();
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
	for (let index = 0; index < 25; index += 1) {
		await saveMessage({
			asOwner,
			workspaceId: ownerWorkspaceId,
			chatId: `batched-active-chat-${index}`,
			messageId: "first",
			projectId,
		});
	}

	await asOwner.mutation(api.projects.remove, {
		workspaceId: ownerWorkspaceId,
		id: projectId,
	});
	const pendingChats = await t.run(
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
				.take(100),
	);
	expect(pendingChats).toHaveLength(27);
	expect(pendingChats.every((chat) => chat.projectId === projectId)).toBe(true);

	await t.finishAllScheduledFunctions(vi.runAllTimers);

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
				.take(100),
	);
	expect(chats).toHaveLength(27);
	expect(chats.every((chat) => chat.projectId === null)).toBe(true);
});

test("project context is database-derived and cannot cross workspace ownership", async () => {
	const { asOwner, asOther, ownerWorkspaceId, projectId } =
		await createFixture();
	await asOwner.mutation(api.projects.updateDescription, {
		workspaceId: ownerWorkspaceId,
		id: projectId,
		description: "Исследование интерфейсов",
	});
	await expect(
		asOwner.query(api.projects.getChatContext, {
			workspaceId: ownerWorkspaceId,
			projectId,
		}),
	).resolves.toEqual({
		projectId,
		name: "Research",
		description: "Исследование интерфейсов",
	});
	await expect(
		asOwner.query(api.projects.getChatContext, {
			workspaceId: ownerWorkspaceId,
			projectId: null,
		}),
	).resolves.toBeNull();
	await expect(
		asOther.query(api.projects.getChatContext, {
			workspaceId: ownerWorkspaceId,
			projectId,
		}),
	).rejects.toThrow();
});
