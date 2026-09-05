import { getDomainWithoutSuffix } from "tldts";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { normalizeRelationshipSearchText } from "./relationshipDirectoryModel";

export const getCompanyFallbackDisplayName = (domain: string) => {
	const domainLabel =
		getDomainWithoutSuffix(domain, { allowPrivateDomains: true }) ??
		domain.split(".")[0] ??
		domain;
	const words = domainLabel
		.split(/[-_]+/u)
		.filter(Boolean)
		.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`);

	return words.join(" ") || domain;
};

export const getCompanyDisplayName = (
	company: Pick<Doc<"companies">, "displayName" | "domain">,
) => {
	const displayName = company.displayName.trim();
	return displayName &&
		displayName.toLowerCase() !== company.domain.toLowerCase()
		? displayName
		: getCompanyFallbackDisplayName(company.domain);
};

export const getCompanySearchText = ({
	displayName,
	domain,
}: {
	displayName: string;
	domain: string;
}) => normalizeRelationshipSearchText(`${displayName} ${domain}`);

const normalizeDomainSearch = (value: string) => {
	const candidate = value.replace(/^@/u, "").toLowerCase();
	return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/u.test(candidate)
		? candidate
		: null;
};

const mergeCompanyMatches = (
	exactMatch: Doc<"companies"> | null,
	searchMatches: Doc<"companies">[],
	limit: number,
) => {
	const matches = new Map<Id<"companies">, Doc<"companies">>();
	if (exactMatch) {
		matches.set(exactMatch._id, exactMatch);
	}
	for (const company of searchMatches) {
		matches.set(company._id, company);
	}

	return {
		hasMore: searchMatches.length > limit || matches.size > limit,
		matches: [...matches.values()].slice(0, limit),
	};
};

export const searchWorkspaceCompanies = async (
	ctx: QueryCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	queryText: string,
	limit: number,
) => {
	const exactDomain = normalizeDomainSearch(queryText);
	const normalizedQueryText = normalizeRelationshipSearchText(queryText);
	const [exactMatch, searchMatches] = await Promise.all([
		exactDomain
			? ctx.db
					.query("companies")
					.withIndex(
						"by_ownerTokenIdentifier_and_workspaceId_and_domain",
						(q) =>
							q
								.eq("ownerTokenIdentifier", ownerTokenIdentifier)
								.eq("workspaceId", workspaceId)
								.eq("domain", exactDomain),
					)
					.unique()
			: null,
		normalizedQueryText
			? ctx.db
					.query("companies")
					.withSearchIndex("search_companies", (q) =>
						q
							.search("searchText", normalizedQueryText)
							.eq("ownerTokenIdentifier", ownerTokenIdentifier)
							.eq("workspaceId", workspaceId),
					)
					.take(limit + 1)
			: queryText
				? []
				: ctx.db
						.query("companies")
						.withIndex(
							"by_ownerTokenIdentifier_and_workspaceId_and_domain",
							(q) =>
								q
									.eq("ownerTokenIdentifier", ownerTokenIdentifier)
									.eq("workspaceId", workspaceId),
						)
						.take(limit + 1),
	]);

	return mergeCompanyMatches(exactMatch, searchMatches, limit);
};

export const getOrCreateCompany = async ({
	ctx,
	domain,
	now,
	ownerTokenIdentifier,
	workspaceId,
}: {
	ctx: MutationCtx;
	domain: string;
	now: number;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
}) => {
	const existing = await ctx.db
		.query("companies")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_domain", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("domain", domain),
		)
		.unique();

	if (existing) {
		const displayName = getCompanyDisplayName(existing);
		const searchText = getCompanySearchText({ displayName, domain });
		if (
			existing.displayName !== displayName ||
			existing.searchText !== searchText
		) {
			await ctx.db.patch(existing._id, {
				displayName,
				searchText,
				updatedAt: now,
			});
		}
		return existing._id;
	}
	const displayName = getCompanyFallbackDisplayName(domain);

	return await ctx.db.insert("companies", {
		ownerTokenIdentifier,
		workspaceId,
		domain,
		displayName,
		searchText: getCompanySearchText({ displayName, domain }),
		createdAt: now,
		updatedAt: now,
	});
};

export const deleteCompanyIfOrphaned = async ({
	companyId,
	ctx,
	ownerTokenIdentifier,
	workspaceId,
}: {
	companyId: Id<"companies">;
	ctx: MutationCtx;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
}) => {
	const remainingAssociation = await ctx.db
		.query("noteCompanies")
		.withIndex("by_owner_ws_company_arch_start", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("companyId", companyId),
		)
		.first();

	if (!remainingAssociation) {
		await ctx.db.delete(companyId);
	}
};
