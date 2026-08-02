import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import {
	deleteCompanyIfOrphaned,
	getOrCreateCompany,
	searchWorkspaceCompanies,
} from "./companyDomain";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerTokenIdentifier = "test|owner";

const createFixture = async () => {
	const t = convexTest(schema, modules);
	const workspaceId = await t.run(async (ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);

	return { t, workspaceId };
};

test("company domain creates and searches canonical workspace companies", async () => {
	const { t, workspaceId } = await createFixture();
	const { acmeId, duplicateAcmeId } = await t.run(async (ctx) => ({
		acmeId: await getOrCreateCompany({
			ctx,
			domain: "acme.com",
			now: 2_000,
			ownerTokenIdentifier,
			workspaceId,
		}),
		duplicateAcmeId: await getOrCreateCompany({
			ctx,
			domain: "acme.com",
			now: 3_000,
			ownerTokenIdentifier,
			workspaceId,
		}),
	}));

	expect(duplicateAcmeId).toBe(acmeId);
	expect(
		await t.run((ctx) =>
			searchWorkspaceCompanies(
				ctx,
				ownerTokenIdentifier,
				workspaceId,
				"@ACME.COM",
				5,
			),
		),
	).toMatchObject({
		hasMore: false,
		matches: [{ _id: acmeId, displayName: "acme.com", domain: "acme.com" }],
	});
});

test("company domain deletes a company only after its final note association", async () => {
	const { t, workspaceId } = await createFixture();
	const { companyId, noteCompanyId } = await t.run(async (ctx) => {
		const companyId = await getOrCreateCompany({
			ctx,
			domain: "acme.com",
			now: 2_000,
			ownerTokenIdentifier,
			workspaceId,
		});
		const noteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier,
			workspaceId,
			starredSortOrder: 0,
			title: "Customer meeting",
			content: "",
			searchableText: "",
			visibility: "private",
			isArchived: false,
			createdAt: 2_000,
			updatedAt: 2_000,
		});
		const noteCompanyId = await ctx.db.insert("noteCompanies", {
			ownerTokenIdentifier,
			workspaceId,
			noteId,
			companyId,
			eventStartAt: "2026-08-02T10:00:00.000Z",
			noteIsArchived: false,
			createdAt: 2_000,
		});

		return { companyId, noteCompanyId };
	});

	await t.run((ctx) =>
		deleteCompanyIfOrphaned({
			companyId,
			ctx,
			ownerTokenIdentifier,
			workspaceId,
		}),
	);
	expect(await t.run((ctx) => ctx.db.get(companyId))).not.toBeNull();

	await t.run(async (ctx) => {
		await ctx.db.delete(noteCompanyId);
		await deleteCompanyIfOrphaned({
			companyId,
			ctx,
			ownerTokenIdentifier,
			workspaceId,
		});
	});
	expect(await t.run((ctx) => ctx.db.get(companyId))).toBeNull();
});
