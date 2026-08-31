import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerTokenIdentifier = "test|owner";

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

test("note document migration backfills legacy notes in bounded batches", async () => {
	vi.useFakeTimers();
	const t = convexTest(schema, modules);
	const workspaceId = await t.run((ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);
	const noteIds = await t.run(async (ctx) => {
		const ids: Id<"notes">[] = [];
		for (let index = 0; index < 6; index += 1) {
			ids.push(
				await ctx.db.insert("notes", {
					ownerTokenIdentifier,
					workspaceId,
					isStarred: false,
					starredSortOrder: index,
					title: `Legacy note ${index + 1}`,
					content: createTextDocument(`legacy-content-${index + 1}`),
					searchableText: `legacy text ${index + 1}`,
					visibility: "private",
					isArchived: false,
					createdAt: index + 1,
					updatedAt: index + 1,
				}),
			);
		}
		return ids;
	});

	await t.mutation(internal.noteDocumentMigration.start, {});
	await t.finishAllScheduledFunctions(vi.runAllTimers);

	const documents = await t.run((ctx) =>
		ctx.db.query("noteDocuments").collect(),
	);
	expect(documents).toHaveLength(6);
	expect(documents.find((document) => document.noteId === noteIds[0])).toMatchObject(
		{
			noteId: noteIds[0],
			content: createTextDocument("legacy-content-1"),
			searchableText: "legacy text 1",
			createdAt: 1,
			updatedAt: 1,
		},
	);
});
