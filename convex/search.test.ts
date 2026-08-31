import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
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

test("note catalog omits bodies while search joins canonical document text", async () => {
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
	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Research",
	});
	const { bodyMatchId, titleMatchId } = await t.run(async (ctx) => ({
		bodyMatchId: await insertTestNote(ctx, {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			projectId: project._id,
			starredSortOrder: 0,
			title: "Background",
			searchableText: "Reliability roadmap details",
			visibility: "private",
			isArchived: false,
			createdAt: 2_000,
			updatedAt: 2_000,
		}),
		titleMatchId: await insertTestNote(ctx, {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			starredSortOrder: 0,
			title: "Roadmap decisions",
			searchableText: "Unrelated body",
			visibility: "private",
			isArchived: false,
			createdAt: 3_000,
			updatedAt: 3_000,
		}),
	}));

	const results = await asOwner.query(api.search.command, {
		workspaceId,
		query: "roadmap",
		kind: "notes",
	});

	expect(results.map((result) => result.id)).toEqual([
		titleMatchId,
		bodyMatchId,
	]);
	expect(results.find((result) => result.id === bodyMatchId)).toMatchObject({
		projectName: "Research",
		preview: "Reliability roadmap details",
	});

	const catalog = await asOwner.query(api.notes.list, {
		workspaceId,
		paginationOpts: { cursor: null, numItems: 30 },
	});
	const catalogNote = catalog.page.find((note) => note._id === bodyMatchId);
	expect(catalogNote).not.toHaveProperty("content");
	expect(catalogNote).not.toHaveProperty("searchableText");
	await expect(
		asOwner.query(api.notes.get, { id: bodyMatchId, workspaceId }),
	).resolves.toMatchObject({ searchableText: "Reliability roadmap details" });

	await asOwner.mutation(api.notes.moveToTrash, {
		workspaceId,
		id: bodyMatchId,
	});
	await expect(
		asOwner.query(api.search.command, {
			workspaceId,
			query: "roadmap",
			kind: "notes",
		}),
	).resolves.toEqual([
		expect.objectContaining({ id: titleMatchId, title: "Roadmap decisions" }),
	]);
});

test("note catalog returns stable cursor pages in descending update order", async () => {
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
	await t.run(async (ctx) => {
		for (const [index, title] of ["Oldest", "Middle", "Newest"].entries()) {
			await insertTestNote(ctx, {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId,
				starredSortOrder: 0,
				title,
				searchableText: title,
				visibility: "private",
				isArchived: false,
				createdAt: 2_000 + index,
				updatedAt: 2_000 + index,
			});
		}
	});

	const firstPage = await asOwner.query(api.notes.list, {
		workspaceId,
		paginationOpts: { cursor: null, numItems: 2 },
	});
	expect(firstPage.page.map((note) => note.title)).toEqual(["Newest", "Middle"]);
	expect(firstPage.isDone).toBe(false);

	const secondPage = await asOwner.query(api.notes.list, {
		workspaceId,
		paginationOpts: { cursor: firstPage.continueCursor, numItems: 2 },
	});
	expect(secondPage.page.map((note) => note.title)).toEqual(["Oldest"]);
	expect(secondPage.isDone).toBe(true);
});
