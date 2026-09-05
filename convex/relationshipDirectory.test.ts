import type { FunctionReturnType } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import {
	type DirectoryEntry,
	selectDirectoryEntries,
} from "./relationshipDirectoryModel";
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

	const asOwner = t.withIdentity(ownerIdentity);
	const read = async (kind: "people" | "companies", query: string) => {
		const queries =
			kind === "people"
				? [api.relationshipDirectory.listPeople]
				: [
						api.relationshipDirectory.listCompanies,
						api.relationshipDirectory.listCompaniesFromPeople,
					];
		const entries: DirectoryEntry[] = [];
		for (const reference of queries) {
			let cursor: string | null = null;
			for (;;) {
				const result: FunctionReturnType<
					typeof api.relationshipDirectory.listPeople
				> = await asOwner.query(reference, {
					workspaceId,
					query,
					paginationOpts: { cursor, numItems: 100 },
				});
				entries.push(...result.page);
				if (result.isDone) break;
				expect(result.continueCursor).not.toBe(cursor);
				cursor = result.continueCursor;
			}
		}
		return selectDirectoryEntries(entries, kind);
	};
	const readCompanies = async (query: string) => {
		const result = await read("companies", query);
		return {
			companies: result.entities.map((entry) => ({
				displayName: entry.label,
				domain: entry.key,
			})),
			hasMore: result.hasMore,
		};
	};

	return {
		asOther: t.withIdentity(otherIdentity),
		asOwner,
		t,
		read,
		readCompanies,
		workspaceId,
	};
};

test("company directory lists and searches workspace companies", async () => {
	const { readCompanies } = await createFixture();

	expect(await readCompanies("")).toEqual({
		companies: [
			{ displayName: "Acme", domain: "acme.com" },
			{ displayName: "Contoso", domain: "contoso.com" },
			{ displayName: "Northwind", domain: "northwind.example" },
		],
		hasMore: false,
	});
	expect(await readCompanies("contoso")).toEqual({
		companies: [{ displayName: "Contoso", domain: "contoso.com" }],
		hasMore: false,
	});
	expect(await readCompanies("northwind")).toEqual({
		companies: [{ displayName: "Northwind", domain: "northwind.example" }],
		hasMore: false,
	});
	expect(await readCompanies("northwind.example")).toEqual({
		companies: [{ displayName: "Northwind", domain: "northwind.example" }],
		hasMore: false,
	});
});

test("company directory excludes public email providers", async () => {
	const { readCompanies } = await createFixture();

	await expect(readCompanies("google")).resolves.toEqual({
		companies: [],
		hasMore: false,
	});
	await expect(readCompanies("yandex")).resolves.toEqual({
		companies: [],
		hasMore: false,
	});
});

test("company directory enforces workspace ownership", async () => {
	const { asOther, workspaceId } = await createFixture();

	await expect(
		asOther.query(api.relationshipDirectory.listCompanies, {
			query: "",
			workspaceId,
			paginationOpts: { cursor: null, numItems: 100 },
		}),
	).rejects.toThrow();
});

test("directory search reaches people and companies beyond the old scan prefix", async () => {
	const { t, asOwner, workspaceId, read, readCompanies } =
		await createFixture();
	await t.run(async (ctx) => {
		for (let index = 0; index < 550; index++) {
			const key = index.toString().padStart(4, "0");
			await ctx.db.insert("people", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId,
				email: `a${key}@filler.example`,
				displayName: "Unrelated Guest",
				searchText: "unrelated guest",
				createdAt: 1,
				updatedAt: 1,
			});
			await ctx.db.insert("companies", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId,
				domain: `a${key}.example`,
				displayName: `Filler ${key}`,
				searchText: `filler ${key}`,
				createdAt: 1,
				updatedAt: 1,
			});
		}
		await ctx.db.insert("people", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			email: "zara@zz-tail.example",
			displayName: "Зара Соколова",
			searchText: "зара соколова zara@zz-tail.example",
			createdAt: 1,
			updatedAt: 1,
		});
		await ctx.db.insert("companies", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			domain: "zz-tail.example",
			displayName: "Actual Company",
			searchText: "actual company zz tail example",
			createdAt: 1,
			updatedAt: 1,
		});
		await ctx.db.insert("people", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			email: "zz@zz-derived.co.uk",
			searchText: "zz@zz-derived.co.uk",
			createdAt: 1,
			updatedAt: 1,
		});
	});

	const firstPage = await asOwner.query(api.relationshipDirectory.listPeople, {
		workspaceId,
		query: "КОЛОВА зар",
		paginationOpts: { cursor: null, numItems: 100 },
	});
	expect(firstPage.page).toEqual([]);
	expect(firstPage.isDone).toBe(false);
	expect(await read("people", "КОЛОВА зар")).toEqual({
		entities: [
			{
				key: "zara@zz-tail.example",
				label: "Зара Соколова",
				subtitle: "zara@zz-tail.example",
			},
		],
		hasMore: false,
	});
	expect(await read("people", "zara@zz-tail.example")).toMatchObject({
		entities: [{ key: "zara@zz-tail.example" }],
		hasMore: false,
	});
	expect(await readCompanies("actual company")).toEqual({
		companies: [{ displayName: "Actual Company", domain: "zz-tail.example" }],
		hasMore: false,
	});
	expect(await readCompanies("zz-tail.example")).toEqual({
		companies: [{ displayName: "Actual Company", domain: "zz-tail.example" }],
		hasMore: false,
	});
	expect(await readCompanies("derived")).toEqual({
		companies: [{ displayName: "Zz Derived", domain: "zz-derived.co.uk" }],
		hasMore: false,
	});
	expect(await readCompanies("missing")).toEqual({
		companies: [],
		hasMore: false,
	});
	expect(await read("people", "missing")).toEqual({
		entities: [],
		hasMore: false,
	});
});

test("company overflow counts distinct matching domains, not pages or people", async () => {
	const { t, workspaceId, readCompanies } = await createFixture();
	await t.run(async (ctx) => {
		for (let index = 0; index < 550; index++) {
			await ctx.db.insert("people", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId,
				email: `person-${index}@repeated.example`,
				searchText: "repeated",
				createdAt: 1,
				updatedAt: 1,
			});
		}
	});
	expect(await readCompanies("repeated")).toEqual({
		companies: [{ displayName: "Repeated", domain: "repeated.example" }],
		hasMore: false,
	});
});

test("directories cap matching entries after global ordering and deduplication", async () => {
	const { t, workspaceId, read, readCompanies } = await createFixture();
	await t.run(async (ctx) => {
		for (let index = 0; index < 101; index++) {
			const key = index.toString().padStart(3, "0");
			await ctx.db.insert("people", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId,
				email: `overflow-${key}@overflow-${key}.example`,
				searchText: `overflow ${key}`,
				createdAt: 1,
				updatedAt: 1,
			});
			await ctx.db.insert("companies", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId,
				domain: `overflow-${key}.example`,
				displayName: `Overflow ${(100 - index).toString().padStart(3, "0")}`,
				searchText: "overflow",
				createdAt: 1,
				updatedAt: 1,
			});
		}
	});
	const people = await read("people", "overflow");
	expect(people.hasMore).toBe(true);
	expect(people.entities).toHaveLength(100);
	expect(people.entities[0]?.key).toBe("overflow-000@overflow-000.example");
	const companies = await readCompanies("overflow");
	expect(companies.hasMore).toBe(true);
	expect(companies.companies).toHaveLength(100);
	expect(companies.companies[0]).toEqual({
		displayName: "Overflow 000",
		domain: "overflow-100.example",
	});
	expect(companies.companies.at(-1)?.displayName).toBe("Overflow 099");
});

test("every directory source rejects unauthorized reads and invalid query bounds", async () => {
	const { t, asOwner, asOther, workspaceId } = await createFixture();
	for (const reference of [
		api.relationshipDirectory.listPeople,
		api.relationshipDirectory.listCompanies,
		api.relationshipDirectory.listCompaniesFromPeople,
	]) {
		const args = {
			workspaceId,
			query: "",
			paginationOpts: { cursor: null, numItems: 100 },
		};
		await expect(asOther.query(reference, args)).rejects.toThrow();
		await expect(t.query(reference, args)).rejects.toThrow();
		await expect(
			asOwner.query(reference, { ...args, query: "a".repeat(321) }),
		).rejects.toThrow(/320/);
		for (const numItems of [0, -1, 101, 1.5]) {
			await expect(
				asOwner.query(reference, {
					...args,
					paginationOpts: { cursor: null, numItems },
				}),
			).rejects.toThrow(/between 1 and 100/);
		}
	}
});
