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

test("note version lists omit bodies and selected reads stay note-scoped", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const { noteId, noteRevisionId, otherRevisionId, workspaceId } = await t.run(
		async (ctx) => {
			const workspaceId = await ctx.db.insert("workspaces", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				name: "Workspace",
				normalizedName: "workspace",
				createdAt: 1_000,
				updatedAt: 1_000,
			});
			const noteId = await insertTestNote(ctx, {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId,
				authorName: "Owner",
				starredSortOrder: 0,
				title: "Current note",
				content: createTextDocument("current body"),
				searchableText: "current body",
				visibility: "private",
				isArchived: false,
				createdAt: 1_000,
				updatedAt: 3_000,
			});
			const otherNoteId = await insertTestNote(ctx, {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId,
				starredSortOrder: 0,
				title: "Other note",
				content: createTextDocument("other body"),
				searchableText: "other body",
				visibility: "private",
				isArchived: false,
				createdAt: 1_000,
				updatedAt: 3_000,
			});
			const noteRevisionId = await ctx.db.insert("noteRevisions", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId,
				noteId,
				authorName: "Owner",
				title: "Historical note",
				content: createTextDocument("historical body"),
				searchableText: "historical body",
				createdAt: 2_000,
			});
			const otherRevisionId = await ctx.db.insert("noteRevisions", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId,
				noteId: otherNoteId,
				authorName: "Owner",
				title: "Other historical note",
				content: createTextDocument("other historical body"),
				searchableText: "other historical body",
				createdAt: 2_000,
			});
			return { noteId, noteRevisionId, otherRevisionId, workspaceId };
		},
	);

	const versions = await asOwner.query(api.noteVersions.list, {
		id: noteId,
		workspaceId,
	});
	expect(versions.map((version) => version.id)).toEqual([
		"current",
		noteRevisionId,
	]);
	expect(versions[0]).not.toHaveProperty("content");
	expect(versions[1]).not.toHaveProperty("searchableText");

	await expect(
		asOwner.query(api.noteVersions.get, {
			id: noteId,
			versionId: "current",
			workspaceId,
		}),
	).resolves.toMatchObject({
		content: createTextDocument("current body"),
		searchableText: "current body",
	});
	await expect(
		asOwner.query(api.noteVersions.get, {
			id: noteId,
			versionId: noteRevisionId,
			workspaceId,
		}),
	).resolves.toMatchObject({
		content: createTextDocument("historical body"),
		searchableText: "historical body",
	});
	await expect(
		asOwner.query(api.noteVersions.get, {
			id: noteId,
			versionId: otherRevisionId,
			workspaceId,
		}),
	).resolves.toBeNull();
});
