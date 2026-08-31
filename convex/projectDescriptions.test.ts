import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
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

test("project description context is bounded to the latest notes in its project", async () => {
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
	const otherProject = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Other",
	});

	await t.run(async (ctx) => {
		const insertNote = ({
			projectId,
			title,
			text,
			updatedAt,
			isArchived = false,
		}: {
			projectId: Id<"projects">;
			title: string;
			text: string;
			updatedAt: number;
			isArchived?: boolean;
		}) =>
			insertTestNote(ctx, {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId,
				projectId,
				starredSortOrder: 0,
				title,
				searchableText: text,
				visibility: "private",
				isArchived,
				archivedAt: isArchived ? updatedAt : undefined,
				createdAt: updatedAt,
				updatedAt,
			});

		await Promise.all([
			...Array.from({ length: 25 }, (_, index) => {
				const number = index + 1;
				return insertNote({
					projectId: project._id,
					title: `  Target ${number}  `,
					text: number === 25 ? "x".repeat(1_100) : `Target text ${number}`,
					updatedAt: number,
				});
			}),
			...Array.from({ length: 100 }, (_, index) => {
				const number = index + 1;
				return insertNote({
					projectId: otherProject._id,
					title: `Other ${number}`,
					text: `Other text ${number}`,
					updatedAt: 1_000 + number,
				});
			}),
			insertNote({
				projectId: project._id,
				title: "Archived target",
				text: "Archived text",
				updatedAt: 10_000,
				isArchived: true,
			}),
		]);
	});

	const context = await asOwner.query(api.projectDescriptions.getContext, {
		workspaceId,
		projectId: project._id,
	});

	expect(context).toHaveLength(20);
	expect(context[0]).toEqual({
		title: "Target 25",
		text: "x".repeat(1_000),
	});
	expect(context.at(-1)).toEqual({
		title: "Target 6",
		text: "Target text 6",
	});
	expect(context.some((note) => note.title.startsWith("Other"))).toBe(false);
	expect(context.some((note) => note.title === "Archived target")).toBe(false);

	await t.run(async (ctx) => ctx.db.delete(project._id));

	await expect(
		asOwner.query(api.projectDescriptions.getContext, {
			workspaceId,
			projectId: project._id,
		}),
	).resolves.toEqual([]);
});
