import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
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

afterEach(() => {
	vi.useRealTimers();
});

const createTextDocument = (text: string) =>
	JSON.stringify({
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: [{ type: "text", text }],
			},
		],
	});

const createWorkspaceAndNote = async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const { noteId, workspaceId } = await t.run(async (ctx) => {
		const createdAt = 1_000;
		const sharedAt = 2_000;
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt,
			updatedAt: createdAt,
		});
		const noteId = await insertTestNote(ctx, {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			authorName: "Existing Author",
			isStarred: true,
			starredSortOrder: 0,
			title: "Old title",
			templateSlug: "enhanced",
			content: createTextDocument("old-content"),
			searchableText: "old text",
			visibility: "public",
			shareId: "share-1",
			sharedAt,
			isArchived: false,
			archivedAt: undefined,
			createdAt,
			updatedAt: createdAt,
		});

		return { noteId, workspaceId };
	});

	return {
		asOwner,
		noteId,
		t,
		workspaceId,
	};
};

const createWorkspace = async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const workspaceId = await t.run(async (ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);

	return {
		asOwner,
		t,
		workspaceId,
	};
};

test("notes.save updates content without dropping existing metadata", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-10T18:00:00.000Z"));

	const { asOwner, noteId, t, workspaceId } = await createWorkspaceAndNote();

	const savedId = await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Updated title",
		content: createTextDocument("new-content"),
		searchableText: "new text",
	});

	expect(savedId).toBe(noteId);

	const note = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(note).not.toBeNull();
	expect(note).toMatchObject({
		_id: noteId,
		workspaceId,
		authorName: "Existing Author",
		isStarred: true,
		title: "Updated title",
		templateSlug: "enhanced",
		content: createTextDocument("new-content"),
		searchableText: "new text",
		visibility: "public",
		shareId: "share-1",
		sharedAt: 2_000,
		isArchived: false,
	});
	expect(note?.updatedAt).toBe(Date.now());
	const persistedDocument = await t.run((ctx) =>
		ctx.db
			.query("noteDocuments")
			.withIndex("by_noteId", (query) => query.eq("noteId", noteId))
			.unique(),
	);
	expect(persistedDocument).toMatchObject({
		noteId,
		isArchived: false,
		content: createTextDocument("new-content"),
		searchableText: "new text",
		updatedAt: Date.now(),
	});
});

test("creating a note from an assistant response preserves its stored attachments", async () => {
	vi.useFakeTimers();
	const { asOwner, t, workspaceId } = await createWorkspace();
	const storageId = await t.run((ctx) =>
		ctx.storage.store(
			new Blob(["document"], {
				type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			}),
		),
	);
	const chatId = "chat-note-attachment";
	const messageId = "assistant-note-attachment";
	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId,
		preview: "Created a document",
		message: {
			id: messageId,
			role: "assistant",
			partsJson: JSON.stringify([
				{
					type: "file",
					filename: "report.docx",
					mediaType:
						"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					providerMetadata: {
						graneri: { sizeBytes: 8, storageId },
					},
					url: "https://files.example.test/report.docx?signature=chat",
				},
			]),
			text: "Created a document",
			createdAt: 2_000,
		},
	});

	const noteId = await asOwner.mutation(api.noteFromChat.create, {
		workspaceId,
		chatId,
		messageId,
		title: "Created document",
		content: createTextDocument("Created a document"),
		searchableText: "Created a document",
	});
	const storedNoteState = await t.run(async (ctx) => ({
		note: await ctx.db.get(noteId),
		document: await ctx.db
			.query("noteDocuments")
			.withIndex("by_noteId", (query) => query.eq("noteId", noteId))
			.unique(),
		attachments: await ctx.db
			.query("noteAttachmentReferences")
			.withIndex("by_noteId", (query) => query.eq("noteId", noteId))
			.collect(),
		documentReferences: await ctx.db
			.query("noteAttachmentDocumentReferences")
			.withIndex("by_noteId_and_revisionId", (query) =>
				query.eq("noteId", noteId).eq("revisionId", null),
			)
			.collect(),
	}));
	expect(storedNoteState.attachments).toHaveLength(1);
	const attachment = storedNoteState.attachments[0];
	if (!attachment) {
		throw new Error("Expected the copied note attachment.");
	}
	expect(attachment).toMatchObject({
		filename: "report.docx",
		mediaType:
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		sizeBytes: 8,
		storageId,
	});
	expect(storedNoteState.documentReferences).toMatchObject([
		{ noteAttachmentId: attachment._id, revisionId: null },
	]);
	expect(JSON.parse(storedNoteState.document?.content ?? "{}")).toMatchObject({
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: [{ type: "text", text: "Created a document" }],
			},
			{
				type: "noteFile",
				attrs: {
					noteAttachmentId: attachment._id,
					filename: "report.docx",
				},
			},
			{ type: "paragraph" },
		],
	});
	const downloadableAttachment = await asOwner.query(api.notes.getAttachment, {
		id: attachment._id,
	});
	expect(downloadableAttachment?.url).toContain("/api/storage/");

	await asOwner.mutation(api.chats.remove, { workspaceId, chatId });
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	expect(await t.run((ctx) => ctx.db.system.get(storageId))).not.toBeNull();

	await asOwner.mutation(api.notes.remove, { workspaceId, id: noteId });
	expect(await t.run((ctx) => ctx.db.system.get(storageId))).toBeNull();
	expect(
		await t.run((ctx) =>
			ctx.db
				.query("noteAttachmentReferences")
				.withIndex("by_storageId", (query) => query.eq("storageId", storageId))
				.collect(),
		),
	).toEqual([]);
	expect(
		await t.run((ctx) =>
			ctx.db
				.query("noteAttachmentDocumentReferences")
				.withIndex("by_noteId_and_revisionId", (query) =>
					query.eq("noteId", noteId),
				)
				.collect(),
		),
	).toEqual([]);
	expect(
		await t.run((ctx) =>
			ctx.db
				.query("noteDocuments")
				.withIndex("by_noteId", (query) => query.eq("noteId", noteId))
				.unique(),
		),
	).toBeNull();
});

test("notes.save rejects non-canonical content without changing note state", async () => {
	const { asOwner, noteId, t, workspaceId } = await createWorkspaceAndNote();
	const noteBeforeSave = await t.run((ctx) => ctx.db.get(noteId));

	await expect(
		asOwner.mutation(api.notes.save, {
			workspaceId,
			id: noteId,
			title: "Invalid update",
			content: "# Legacy markdown",
			searchableText: "Legacy markdown",
		}),
	).rejects.toThrow("valid Tiptap JSON");

	const storedState = await t.run(async (ctx) => ({
		note: await ctx.db.get(noteId),
		references: await ctx.db
			.query("noteImageReferences")
			.withIndex("by_noteId_and_revisionId", (query) =>
				query.eq("noteId", noteId),
			)
			.collect(),
		revisions: await ctx.db
			.query("noteRevisions")
			.withIndex("by_ownerTokenIdentifier_and_noteId", (query) =>
				query
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("noteId", noteId),
			)
			.collect(),
	}));

	expect(storedState).toEqual({
		note: noteBeforeSave,
		references: [],
		revisions: [],
	});
});

test("notes.save commits generated content and its template together", async () => {
	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();

	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Weekly sync",
		content: createTextDocument("weekly-content"),
		searchableText: "weekly text",
		templateSlug: "weekly-team-meeting",
	});

	const note = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(note).toMatchObject({
		content: createTextDocument("weekly-content"),
		searchableText: "weekly text",
		templateSlug: "weekly-team-meeting",
		title: "Weekly sync",
	});
});

test("notes.save records version history for changed payloads", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-10T18:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();

	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Updated title",
		content: createTextDocument("new-content"),
		searchableText: "new text",
	});

	const versions = await asOwner.query(api.noteVersions.list, {
		id: noteId,
		workspaceId,
	});

	expect(versions).toHaveLength(2);
	expect(versions[0]).toMatchObject({
		id: "current",
		isCurrent: true,
		authorName: "Existing Author",
		title: "Updated title",
		createdAt: Date.now(),
	});
	expect(versions[1]).toMatchObject({
		isCurrent: false,
		authorName: "Existing Author",
		title: "Old title",
		createdAt: Date.now(),
	});
});

test("notes.save groups version history by revision interval", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-10T18:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();

	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "First autosave",
		content: createTextDocument("first-content"),
		searchableText: "first text",
	});

	vi.setSystemTime(new Date("2026-04-10T18:00:10.000Z"));

	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Second autosave",
		content: createTextDocument("second-content"),
		searchableText: "second text",
	});

	let versions = await asOwner.query(api.noteVersions.list, {
		id: noteId,
		workspaceId,
	});

	expect(versions).toHaveLength(2);
	expect(versions[1]).toMatchObject({
		title: "Old title",
	});

	vi.setSystemTime(new Date("2026-04-10T18:00:31.000Z"));

	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Third autosave",
		content: createTextDocument("third-content"),
		searchableText: "third text",
	});

	versions = await asOwner.query(api.noteVersions.list, {
		id: noteId,
		workspaceId,
	});

	expect(versions).toHaveLength(3);
	expect(versions[1]).toMatchObject({
		title: "Second autosave",
	});
});

test("notes.restoreVersion preserves current note and restores selected revision", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-10T18:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();

	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Updated title",
		content: createTextDocument("new-content"),
		searchableText: "new text",
	});

	const versionsBeforeRestore = await asOwner.query(api.noteVersions.list, {
		id: noteId,
		workspaceId,
	});
	const revisionId = versionsBeforeRestore.find(
		(version) => version.id !== "current",
	)?.id as Id<"noteRevisions"> | undefined;
	expect(revisionId).toBeDefined();

	vi.setSystemTime(new Date("2026-04-10T18:01:00.000Z"));

	await asOwner.mutation(api.notes.restoreVersion, {
		workspaceId,
		id: noteId,
		revisionId: revisionId as Id<"noteRevisions">,
	});

	const note = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});
	expect(note).toMatchObject({
		title: "Old title",
		content: createTextDocument("old-content"),
		searchableText: "old text",
	});

	const versionsAfterRestore = await asOwner.query(api.noteVersions.list, {
		id: noteId,
		workspaceId,
	});
	expect(versionsAfterRestore).toHaveLength(3);
	expect(versionsAfterRestore[1]).toMatchObject({
		title: "Updated title",
	});
});

test("notes.save is a no-op when the payload is unchanged", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-10T18:00:00.000Z"));

	const { asOwner, noteId, workspaceId } = await createWorkspaceAndNote();
	const noteBeforeSave = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(noteBeforeSave).not.toBeNull();

	vi.setSystemTime(new Date("2026-04-10T18:05:00.000Z"));

	const savedId = await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Old title",
		content: createTextDocument("old-content"),
		searchableText: "old text",
	});

	expect(savedId).toBe(noteId);

	const noteAfterSave = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(noteAfterSave).not.toBeNull();
	expect(noteAfterSave?.updatedAt).toBe(noteBeforeSave?.updatedAt);
	expect(noteAfterSave).toMatchObject({
		_id: noteId,
		title: "Old title",
		content: createTextDocument("old-content"),
		searchableText: "old text",
		templateSlug: "enhanced",
		visibility: "public",
	});

	const versions = await asOwner.query(api.noteVersions.list, {
		id: noteId,
		workspaceId,
	});
	expect(versions).toHaveLength(1);
	expect(versions[0]?.id).toBe("current");
});

test("notes.create and notes.rename preserve empty titles", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const noteId = await asOwner.mutation(api.notes.create, {
		workspaceId,
		projectId: null,
	});
	const createdNote = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(createdNote).not.toBeNull();
	expect(createdNote?.title).toBe("");

	const renamed = await asOwner.mutation(api.notes.rename, {
		workspaceId,
		id: noteId,
		title: "   ",
	});
	const renamedNote = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(renamed.title).toBe("");
	expect(renamedNote).not.toBeNull();
	expect(renamedNote?.title).toBe("");
});

test("notes.create can place a note inside a project", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});

	const noteId = await asOwner.mutation(api.notes.create, {
		workspaceId,
		projectId: project._id,
	});
	const createdNote = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(createdNote).not.toBeNull();
	expect(createdNote?.projectId).toBe(project._id);
	expect(createdNote?.title).toBe("");
});

test("notes.setProject assigns and clears a project without dropping note metadata", async () => {
	const { asOwner, noteId, t, workspaceId } = await createWorkspaceAndNote();

	const projectId = await t.run(async (ctx) =>
		ctx.db.insert("projects", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			name: "Product",
			description: "",
			normalizedName: "product",
			icon: "folder",
			color: "default",
			isStarred: false,
			sortOrder: 3_000,
			starredSortOrder: 0,
			createdAt: 3_000,
			updatedAt: 3_000,
		}),
	);

	const assigned = await asOwner.mutation(api.notes.setProject, {
		workspaceId,
		id: noteId,
		projectId,
	});
	const assignedNote = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(assigned.projectId).toBe(projectId);
	expect(assignedNote).not.toBeNull();
	expect(assignedNote).toMatchObject({
		_id: noteId,
		projectId,
		title: "Old title",
		templateSlug: "enhanced",
		visibility: "public",
	});

	const cleared = await asOwner.mutation(api.notes.setProject, {
		workspaceId,
		id: noteId,
		projectId: null,
	});
	const clearedNote = await asOwner.query(api.notes.get, {
		id: noteId,
		workspaceId,
	});

	expect(cleared.projectId).toBeNull();
	expect(clearedNote).not.toBeNull();
	expect(clearedNote?.projectId).toBeUndefined();
	expect(clearedNote?.title).toBe("Old title");
});

test("notes.remove deletes note comments and threads", async () => {
	const { asOwner, noteId, t, workspaceId } = await createWorkspaceAndNote();

	await asOwner.mutation(api.noteComments.createThread, {
		workspaceId,
		noteId,
		excerpt: "old-content",
		body: "This needs follow-up.",
	});

	await asOwner.mutation(api.notes.remove, {
		workspaceId,
		id: noteId,
	});

	const relatedRows = await t.run(async (ctx) => ({
		comments: await ctx.db.query("noteComments").take(10),
		note: await ctx.db.get(noteId),
		threads: await ctx.db.query("noteCommentThreads").take(10),
	}));

	expect(relatedRows.note).toBeNull();
	expect(relatedRows.comments).toHaveLength(0);
	expect(relatedRows.threads).toHaveLength(0);
});

const createImageDocument = (noteImageId: Id<"noteImages">, url: string) =>
	JSON.stringify({
		type: "doc",
		content: [
			{
				type: "image",
				attrs: { noteImageId, src: url, alt: "Diagram" },
			},
		],
	});

test("note images stay alive through revisions and are deleted with the note", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-10T18:00:00.000Z"));
	const { asOwner, noteId, t, workspaceId } = await createWorkspaceAndNote();
	const storageId = await t.run((ctx) =>
		ctx.storage.store(new Blob(["image"], { type: "image/png" })),
	);
	const uploaded = await t.mutation(internal.noteImages.registerUploadedImage, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		workspaceId,
		noteId,
		storageId,
		fileName: "diagram.png",
		contentType: "image/png",
		size: 5,
	});
	const imageContent = createImageDocument(uploaded.noteImageId, uploaded.url);

	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "With image",
		content: imageContent,
		searchableText: "",
	});
	vi.advanceTimersByTime(31_000);
	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "Without image",
		content: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
		searchableText: "",
	});

	const storedAfterRemoval = await t.run(async (ctx) => ({
		image: await ctx.db.get(uploaded.noteImageId),
		references: await ctx.db
			.query("noteImageReferences")
			.withIndex("by_noteImageId", (query) =>
				query.eq("noteImageId", uploaded.noteImageId),
			)
			.collect(),
		storage: await ctx.db.system.get(storageId),
	}));
	expect(storedAfterRemoval.image).not.toBeNull();
	expect(storedAfterRemoval.storage).not.toBeNull();
	expect(storedAfterRemoval.references).toHaveLength(1);
	expect(storedAfterRemoval.references[0]?.revisionId).not.toBeNull();
	const versions = await asOwner.query(api.noteVersions.list, {
		workspaceId,
		id: noteId,
	});
	const imageRevision = versions.find(
		(version) => version.id !== "current" && version.title === "With image",
	);
	if (!imageRevision || imageRevision.id === "current") {
		throw new Error("Expected the image revision to be retained.");
	}
	await asOwner.mutation(api.notes.restoreVersion, {
		workspaceId,
		id: noteId,
		revisionId: imageRevision.id,
	});
	const restored = await asOwner.query(api.notes.get, {
		workspaceId,
		id: noteId,
	});
	const referencesAfterRestore = await t.run((ctx) =>
		ctx.db
			.query("noteImageReferences")
			.withIndex("by_noteImageId", (query) =>
				query.eq("noteImageId", uploaded.noteImageId),
			)
			.collect(),
	);
	expect(restored?.content).toBe(imageContent);
	expect(referencesAfterRestore).toHaveLength(2);
	expect(
		referencesAfterRestore.some((reference) => reference.revisionId === null),
	).toBe(true);

	await asOwner.mutation(api.notes.remove, { workspaceId, id: noteId });
	const storedAfterNoteRemoval = await t.run(async (ctx) => ({
		image: await ctx.db.get(uploaded.noteImageId),
		references: await ctx.db
			.query("noteImageReferences")
			.withIndex("by_noteImageId", (query) =>
				query.eq("noteImageId", uploaded.noteImageId),
			)
			.collect(),
		storage: await ctx.db.system.get(storageId),
	}));
	expect(storedAfterNoteRemoval).toEqual({
		image: null,
		references: [],
		storage: null,
	});
});

test("restoring the oldest retained revision preserves its images while pruning", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-04-10T18:00:00.000Z"));
	const { asOwner, noteId, t, workspaceId } = await createWorkspaceAndNote();
	const storageId = await t.run((ctx) =>
		ctx.storage.store(new Blob(["image"], { type: "image/png" })),
	);
	const uploaded = await t.mutation(internal.noteImages.registerUploadedImage, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		workspaceId,
		noteId,
		storageId,
		fileName: "oldest.png",
		contentType: "image/png",
		size: 5,
	});
	const imageContent = createImageDocument(uploaded.noteImageId, uploaded.url);
	const oldestRevisionId = await t.run(async (ctx) => {
		const note = await ctx.db.get(noteId);
		if (!note) {
			throw new Error("Expected note to exist");
		}
		const revisionId = await ctx.db.insert("noteRevisions", {
			ownerTokenIdentifier: note.ownerTokenIdentifier,
			workspaceId,
			noteId,
			authorName: note.authorName ?? "",
			title: "Oldest image revision",
			content: imageContent,
			searchableText: "",
			createdAt: 1,
		});
		await ctx.db.insert("noteImageReferences", {
			noteId,
			revisionId,
			noteImageId: uploaded.noteImageId,
		});

		for (let index = 1; index < 50; index += 1) {
			await ctx.db.insert("noteRevisions", {
				ownerTokenIdentifier: note.ownerTokenIdentifier,
				workspaceId,
				noteId,
				authorName: note.authorName ?? "",
				title: `Revision ${index}`,
				content: JSON.stringify({
					type: "doc",
					content: [{ type: "paragraph" }],
				}),
				searchableText: "",
				createdAt: index + 1,
			});
		}

		return revisionId;
	});

	await asOwner.mutation(api.notes.restoreVersion, {
		workspaceId,
		id: noteId,
		revisionId: oldestRevisionId,
	});

	const stored = await t.run(async (ctx) => ({
		document: await ctx.db
			.query("noteDocuments")
			.withIndex("by_noteId", (query) => query.eq("noteId", noteId))
			.unique(),
		image: await ctx.db.get(uploaded.noteImageId),
		note: await ctx.db.get(noteId),
		references: await ctx.db
			.query("noteImageReferences")
			.withIndex("by_noteImageId", (query) =>
				query.eq("noteImageId", uploaded.noteImageId),
			)
			.collect(),
		revisionCount: (
			await ctx.db
				.query("noteRevisions")
				.withIndex("by_ownerTokenIdentifier_and_noteId", (query) =>
					query
						.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
						.eq("noteId", noteId),
				)
				.collect()
		).length,
		storage: await ctx.db.system.get(storageId),
	}));

	expect(stored.document?.content).toBe(imageContent);
	expect(stored.image).not.toBeNull();
	expect(stored.storage).not.toBeNull();
	expect(stored.revisionCount).toBe(50);
	expect(stored.references).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ revisionId: oldestRevisionId }),
			expect.objectContaining({ revisionId: null }),
		]),
	);
});

test("pending note images are deleted when they never reach a saved document", async () => {
	vi.useFakeTimers();
	const { noteId, t, workspaceId } = await createWorkspaceAndNote();
	const storageId = await t.run((ctx) =>
		ctx.storage.store(new Blob(["image"], { type: "image/png" })),
	);
	const uploaded = await t.mutation(internal.noteImages.registerUploadedImage, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		workspaceId,
		noteId,
		storageId,
		fileName: "unused.png",
		contentType: "image/png",
		size: 5,
	});

	await t.finishAllScheduledFunctions(vi.runAllTimers);

	expect(await t.run((ctx) => ctx.db.get(uploaded.noteImageId))).toBeNull();
	expect(await t.run((ctx) => ctx.db.system.get(storageId))).toBeNull();
});

test("notes reject image ids owned by another note", async () => {
	const { asOwner, noteId, t, workspaceId } = await createWorkspaceAndNote();
	const otherNoteId = await asOwner.mutation(api.notes.create, {
		workspaceId,
		projectId: null,
	});
	const storageId = await t.run((ctx) =>
		ctx.storage.store(new Blob(["image"], { type: "image/png" })),
	);
	const uploaded = await t.mutation(internal.noteImages.registerUploadedImage, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		workspaceId,
		noteId: otherNoteId,
		storageId,
		fileName: "other.png",
		contentType: "image/png",
		size: 5,
	});

	await expect(
		asOwner.mutation(api.notes.save, {
			workspaceId,
			id: noteId,
			title: "Wrong image",
			content: createImageDocument(uploaded.noteImageId, uploaded.url),
			searchableText: "",
		}),
	).rejects.toThrow("does not belong to the note");
});

test("notes reject external sources attached to a valid note image id", async () => {
	const { asOwner, noteId, t, workspaceId } = await createWorkspaceAndNote();
	const storageId = await t.run((ctx) =>
		ctx.storage.store(new Blob(["image"], { type: "image/png" })),
	);
	const uploaded = await t.mutation(internal.noteImages.registerUploadedImage, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		workspaceId,
		noteId,
		storageId,
		fileName: "diagram.png",
		contentType: "image/png",
		size: 5,
	});

	await expect(
		asOwner.mutation(api.notes.save, {
			workspaceId,
			id: noteId,
			title: "External source",
			content: createImageDocument(
				uploaded.noteImageId,
				"https://tracker.test/image.png",
			),
			searchableText: "",
		}),
	).rejects.toThrow("does not use its Convex storage URL");
});

test("notes reject unowned images on first save", async () => {
	const { asOwner, t, workspaceId } = await createWorkspaceAndNote();

	await expect(
		asOwner.mutation(api.notes.save, {
			workspaceId,
			title: "Unsafe image",
			content: JSON.stringify({
				type: "doc",
				content: [
					{
						type: "image",
						attrs: { src: "https://tracker.test/image.png" },
					},
				],
			}),
			searchableText: "",
		}),
	).rejects.toThrow("must be uploaded before they are saved");
	expect(await t.run((ctx) => ctx.db.query("notes").collect())).toHaveLength(1);
});
