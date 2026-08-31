import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
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

afterEach(() => {
	vi.useRealTimers();
});

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

test("projects.create trims names and projects.list keeps custom order", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const zebraId = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "  Zebra  ",
	});
	const alphaId = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Alpha",
	});

	expect(zebraId.name).toBe("Zebra");
	expect(alphaId.name).toBe("Alpha");

	const projects = await asOwner.query(api.projects.list, {
		workspaceId,
	});

	expect(projects.map((project) => project.name)).toEqual(["Zebra", "Alpha"]);
});

test("projects.reorder persists the custom project order", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const product = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});
	const research = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Research",
	});
	const sales = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Sales",
	});

	await asOwner.mutation(api.projects.reorder, {
		workspaceId,
		projectIds: [sales._id, product._id, research._id],
	});

	const projects = await asOwner.query(api.projects.list, {
		workspaceId,
	});

	expect(projects.map((project) => project.name)).toEqual([
		"Sales",
		"Product",
		"Research",
	]);
	expect(projects.map((project) => project.sortOrder)).toEqual([0, 1, 2]);
});

test("projects.reorder rejects oversized project lists instead of partially reordering", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const projectIds = await asOwner.run(async (ctx) => {
		const ids = [];
		for (let index = 0; index < 101; index += 1) {
			ids.push(
				await ctx.db.insert("projects", {
					ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
					workspaceId,
					name: `Project ${index}`,
					description: "",
					normalizedName: `project ${index}`,
					icon: "folder",
					color: "default",
					isStarred: false,
					sortOrder: index,
					starredSortOrder: index,
					createdAt: index,
					updatedAt: index,
				}),
			);
		}
		return ids;
	});

	await expect(
		asOwner
			.mutation(api.projects.reorder, {
				workspaceId,
				projectIds: projectIds.slice(0, 100),
			})
			.catch((error) => {
				expect(error).toBeInstanceOf(Error);
				expect(String((error as { data?: string }).data)).toContain(
					"PROJECT_ORDER_TOO_LARGE",
				);
				throw error;
			}),
	).rejects.toBeInstanceOf(Error);
});

test("projects.create rejects duplicate names in the same workspace", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});

	await expect(
		asOwner
			.mutation(api.projects.create, {
				workspaceId,
				name: "  product  ",
			})
			.catch((error) => {
				expect(error).toBeInstanceOf(Error);
				expect(String((error as { data?: string }).data)).toContain(
					"PROJECT_ALREADY_EXISTS",
				);
				throw error;
			}),
	).rejects.toBeInstanceOf(Error);
});

test("projects.updateIdentity stores its name, icon, and color", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});
	await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Research",
	});

	const updated = await asOwner.mutation(api.projects.updateIdentity, {
		workspaceId,
		id: project._id,
		name: "  Founding Team  ",
		icon: "terminal",
		color: "blue",
	});

	expect(updated).toMatchObject({
		name: "Founding Team",
		icon: "terminal",
		color: "blue",
	});

	const projects = await asOwner.query(api.projects.list, {
		workspaceId,
	});
	expect(projects.map((entry) => entry.name)).toEqual([
		"Founding Team",
		"Research",
	]);

	await expect(
		asOwner
			.mutation(api.projects.updateIdentity, {
				workspaceId,
				id: project._id,
				name: "research",
				icon: updated.icon,
				color: updated.color,
			})
			.catch((error) => {
				expect(error).toBeInstanceOf(Error);
				expect(String((error as { data?: string }).data)).toContain(
					"PROJECT_ALREADY_EXISTS",
				);
				throw error;
			}),
	).rejects.toBeInstanceOf(Error);
});

test("projects.updateDescription stores descriptions up to 255 characters", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});
	const description = "x".repeat(255);

	const updated = await asOwner.mutation(api.projects.updateDescription, {
		workspaceId,
		id: project._id,
		description,
	});

	expect(updated.description).toBe(description);

	const projects = await asOwner.query(api.projects.list, {
		workspaceId,
	});
	expect(projects[0]?.description).toBe(description);
});

test("projects.updateDescription rejects descriptions over 255 characters", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});

	await expect(
		asOwner
			.mutation(api.projects.updateDescription, {
				workspaceId,
				id: project._id,
				description: "x".repeat(256),
			})
			.catch((error) => {
				expect(error).toBeInstanceOf(Error);
				expect(String((error as { data?: string }).data)).toContain(
					"INVALID_PROJECT_DESCRIPTION",
				);
				throw error;
			}),
	).rejects.toBeInstanceOf(Error);
});

test("projects.toggleStar marks and unmarks a project", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});

	const firstToggle = await asOwner.mutation(api.projects.toggleStar, {
		workspaceId,
		id: project._id,
	});
	expect(firstToggle.isStarred).toBe(true);

	const starredProject = await asOwner.run(async (ctx) =>
		ctx.db.get(project._id),
	);
	expect(starredProject?.isStarred).toBe(true);

	const secondToggle = await asOwner.mutation(api.projects.toggleStar, {
		workspaceId,
		id: project._id,
	});
	expect(secondToggle.isStarred).toBe(false);

	const unstarredProject = await asOwner.run(async (ctx) =>
		ctx.db.get(project._id),
	);
	expect(unstarredProject?.isStarred).toBe(false);
});

test("projects.moveNotesToTrash archives active project notes and keeps the project", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});

	const { activeNoteId, archivedNoteId } = await asOwner.run(async (ctx) => {
		const activeNoteId = await insertTestNote(ctx, {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			projectId: project._id,
			starredSortOrder: 0,
			title: "Active note",
			searchableText: "",
			visibility: "private",
			isArchived: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		const archivedNoteId = await insertTestNote(ctx, {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			projectId: project._id,
			starredSortOrder: 0,
			title: "Archived note",
			searchableText: "",
			visibility: "private",
			isArchived: true,
			archivedAt: 2_000,
			createdAt: 1_000,
			updatedAt: 1_000,
		});

		return { activeNoteId, archivedNoteId };
	});

	const result = await asOwner.mutation(api.projects.moveNotesToTrash, {
		workspaceId,
		id: project._id,
	});
	expect(result.movedCount).toBe(1);

	const projects = await asOwner.query(api.projects.list, { workspaceId });
	expect(projects).toHaveLength(1);

	const activeNote = await asOwner.run(async (ctx) => ctx.db.get(activeNoteId));
	const archivedNote = await asOwner.run(async (ctx) =>
		ctx.db.get(archivedNoteId),
	);

	expect(activeNote?.isArchived).toBe(true);
	expect(activeNote?.projectId).toBe(project._id);
	expect(archivedNote?.isArchived).toBe(true);
	expect(archivedNote?.projectId).toBe(project._id);
});

test("projects.remove deletes the project and clears it from assigned notes", async () => {
	vi.useFakeTimers();
	const { asOwner, t, workspaceId } = await createWorkspace();

	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Flomni",
	});

	const { noteId, archivedNoteId } = await asOwner.run(async (ctx) => {
		const noteId = await insertTestNote(ctx, {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			projectId: project._id,
			starredSortOrder: 0,
			title: "Current note",
			searchableText: "",
			visibility: "private",
			isArchived: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		const archivedNoteId = await insertTestNote(ctx, {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			projectId: project._id,
			starredSortOrder: 0,
			title: "Archived note",
			searchableText: "",
			visibility: "private",
			isArchived: true,
			archivedAt: 2_000,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		for (let index = 0; index < 100; index += 1) {
			await insertTestNote(ctx, {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId,
				projectId: project._id,
				starredSortOrder: 0,
				title: `Batched note ${index}`,
				searchableText: "",
				visibility: "private",
				isArchived: false,
				createdAt: 2_000 + index,
				updatedAt: 2_000 + index,
			});
		}

		return { noteId, archivedNoteId };
	});

	await asOwner.mutation(api.projects.remove, {
		workspaceId,
		id: project._id,
	});

	const projects = await asOwner.query(api.projects.list, {
		workspaceId,
	});
	expect(projects).toHaveLength(0);

	const currentNote = await asOwner.run(async (ctx) => ctx.db.get(noteId));
	expect(currentNote?.projectId).toBe(project._id);

	await t.finishAllScheduledFunctions(vi.runAllTimers);

	const { archivedNote, clearedCurrentNote, remainingProjectNotes } =
		await asOwner.run(async (ctx) => ({
			archivedNote: await ctx.db.get(archivedNoteId),
			clearedCurrentNote: await ctx.db.get(noteId),
			remainingProjectNotes: await ctx.db
				.query("notes")
				.withIndex("by_owner_ws_project_arch_upd", (q) =>
					q
						.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
						.eq("workspaceId", workspaceId)
						.eq("projectId", project._id),
				)
				.take(1),
		}));

	expect(clearedCurrentNote?.projectId).toBeUndefined();
	expect(archivedNote?.projectId).toBeUndefined();
	expect(remainingProjectNotes).toEqual([]);
});
