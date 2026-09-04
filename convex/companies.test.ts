import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
};

const otherIdentity = {
	issuer: "https://graneri.test",
	subject: "other-subject",
	tokenIdentifier: "test|other",
};

const createFixture = async () => {
	const t = convexTest(schema, modules);
	const workspaceId = await t.run(async (ctx) => {
		const nextWorkspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		await Promise.all([
			ctx.db.insert("companies", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId: nextWorkspaceId,
				domain: "acme.com",
				displayName: "Acme",
				searchText: "acme com",
				createdAt: 1_000,
				updatedAt: 1_000,
			}),
			ctx.db.insert("companies", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId: nextWorkspaceId,
				domain: "northwind.example",
				displayName: "Northwind",
				searchText: "northwind example",
				createdAt: 1_000,
				updatedAt: 1_000,
			}),
			ctx.db.insert("companies", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId: nextWorkspaceId,
				domain: "google.com",
				displayName: "Google",
				searchText: "google com",
				createdAt: 1_000,
				updatedAt: 1_000,
			}),
			ctx.db.insert("companies", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId: nextWorkspaceId,
				domain: "yandex.by",
				displayName: "Yandex",
				searchText: "yandex by",
				createdAt: 1_000,
				updatedAt: 1_000,
			}),
			ctx.db.insert("people", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId: nextWorkspaceId,
				email: "person@contoso.com",
				displayName: "Contoso Person",
				searchText: "contoso person person@contoso.com",
				createdAt: 1_000,
				updatedAt: 1_000,
			}),
			ctx.db.insert("people", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId: nextWorkspaceId,
				email: "personal@gmail.com",
				searchText: "personal@gmail.com",
				createdAt: 1_000,
				updatedAt: 1_000,
			}),
			ctx.db.insert("people", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId: nextWorkspaceId,
				email: "personal@yandex.by",
				searchText: "personal@yandex.by",
				createdAt: 1_000,
				updatedAt: 1_000,
			}),
		]);
		return nextWorkspaceId;
	});

	return {
		asOther: t.withIdentity(otherIdentity),
		asOwner: t.withIdentity(ownerIdentity),
		workspaceId,
	};
};

test("company directory lists and searches workspace companies", async () => {
	const { asOwner, workspaceId } = await createFixture();

	expect(
		await asOwner.query(api.companies.listDirectory, {
			query: "",
			workspaceId,
		}),
	).toEqual({
		companies: [
			{ displayName: "Acme", domain: "acme.com" },
			{ displayName: "Contoso", domain: "contoso.com" },
			{ displayName: "Northwind", domain: "northwind.example" },
		],
		hasMore: false,
	});
	expect(
		await asOwner.query(api.companies.listDirectory, {
			query: "contoso",
			workspaceId,
		}),
	).toEqual({
		companies: [{ displayName: "Contoso", domain: "contoso.com" }],
		hasMore: false,
	});
	expect(
		await asOwner.query(api.companies.listDirectory, {
			query: "northwind",
			workspaceId,
		}),
	).toEqual({
		companies: [{ displayName: "Northwind", domain: "northwind.example" }],
		hasMore: false,
	});
	expect(
		await asOwner.query(api.companies.listDirectory, {
			query: "northwind.example",
			workspaceId,
		}),
	).toEqual({
		companies: [{ displayName: "Northwind", domain: "northwind.example" }],
		hasMore: false,
	});
});

test("company directory excludes public email providers", async () => {
	const { asOwner, workspaceId } = await createFixture();

	await expect(
		asOwner.query(api.companies.listDirectory, {
			query: "google",
			workspaceId,
		}),
	).resolves.toEqual({ companies: [], hasMore: false });
	await expect(
		asOwner.query(api.companies.listDirectory, {
			query: "yandex",
			workspaceId,
		}),
	).resolves.toEqual({ companies: [], hasMore: false });
});

test("company directory enforces workspace ownership", async () => {
	const { asOther, workspaceId } = await createFixture();

	await expect(
		asOther.query(api.companies.listDirectory, { query: "", workspaceId }),
	).rejects.toThrow();
});
