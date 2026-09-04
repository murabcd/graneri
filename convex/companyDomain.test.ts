import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import {
	deleteCompanyIfOrphaned,
	getCompanyFallbackDisplayName,
	getOrCreateCompany,
	searchWorkspaceCompanies,
} from "./companyDomain";
import { insertTestNote } from "./noteDocument.fixtures";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerTokenIdentifier = "test|owner";

test("company domain derives a readable fallback without the public suffix", () => {
	expect(getCompanyFallbackDisplayName("bia-tech.ru")).toBe("Bia Tech");
	expect(getCompanyFallbackDisplayName("events.example.co.uk")).toBe("Example");
	expect(getCompanyFallbackDisplayName("flomni.com")).toBe("Flomni");
});

const createFixture = async () => {
	const t = convexTest(schema, modules);
	const workspaceId = await t.run(async (ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
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
		matches: [{ _id: acmeId, displayName: "Acme", domain: "acme.com" }],
	});
	expect(
		await t.run((ctx) =>
			searchWorkspaceCompanies(ctx, ownerTokenIdentifier, workspaceId, "/", 5),
		),
	).toEqual({ hasMore: false, matches: [] });
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
		const noteId = await insertTestNote(ctx, {
			ownerTokenIdentifier,
			workspaceId,
			starredSortOrder: 0,
			title: "Customer meeting",
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
