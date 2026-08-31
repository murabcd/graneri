import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { insertTestNote } from "./noteDocument.fixtures";
import { setNoteArchived, setNoteProject } from "./noteRecords";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerTokenIdentifier = "test|owner";

const createFixture = async () => {
	const t = convexTest(schema, modules);
	const { noteId, projectId } = await t.run(async (ctx) => {
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		const projectId = await ctx.db.insert("projects", {
			ownerTokenIdentifier,
			workspaceId,
			name: "Project",
			description: "",
			normalizedName: "project",
			icon: "folder",
			color: "default",
			isStarred: false,
			sortOrder: 1_000,
			starredSortOrder: 0,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		const noteId = await insertTestNote(ctx, {
			ownerTokenIdentifier,
			workspaceId,
			authorName: "Owner",
			isStarred: false,
			starredSortOrder: 1_000,
			title: "Note",
			visibility: "private",
			isArchived: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		return { noteId, projectId };
	});

	return { noteId, projectId, t };
};

test("note record transitions keep metadata and document search projections aligned", async () => {
	const { noteId, projectId, t } = await createFixture();

	await t.run(async (ctx) => {
		const note = await ctx.db.get(noteId);
		expect(note).not.toBeNull();
		if (!note) {
			return;
		}
		await setNoteProject(ctx, note, projectId, 2_000);
	});

	await t.run(async (ctx) => {
		const note = await ctx.db.get(noteId);
		expect(note).not.toBeNull();
		if (!note) {
			return;
		}
		await setNoteArchived(ctx, note, true, 3_000);
	});

	const stored = await t.run(async (ctx) => ({
		note: await ctx.db.get(noteId),
		document: await ctx.db
			.query("noteDocuments")
			.withIndex("by_noteId", (query) => query.eq("noteId", noteId))
			.unique(),
	}));

	expect(stored.note).toMatchObject({
		projectId,
		isArchived: true,
		archivedAt: 3_000,
		updatedAt: 3_000,
	});
	expect(stored.document).toMatchObject({
		projectId,
		isArchived: true,
		updatedAt: 3_000,
	});
});

test("note record transitions roll back metadata when the document is missing", async () => {
	const t = convexTest(schema, modules);
	const noteId = await t.run(async (ctx) => {
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		return await ctx.db.insert("notes", {
			ownerTokenIdentifier,
			workspaceId,
			authorName: "Owner",
			isStarred: false,
			starredSortOrder: 1_000,
			title: "Note",
			visibility: "private",
			isArchived: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
	});

	await expect(
		t.run(async (ctx) => {
			const note = await ctx.db.get(noteId);
			expect(note).not.toBeNull();
			if (!note) {
				return;
			}
			await setNoteArchived(ctx, note, true, 2_000);
		}),
	).rejects.toThrow("Persisted note document is unavailable.");

	const rolledBackNote = await t.run(async (ctx) => await ctx.db.get(noteId));
	expect(rolledBackNote).toMatchObject({
		isArchived: false,
		updatedAt: 1_000,
	});
	expect(rolledBackNote).not.toHaveProperty("archivedAt");
});
