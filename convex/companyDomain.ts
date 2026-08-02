import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

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
		hasMore: matches.size > limit,
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
		ctx.db
			.query("companies")
			.withSearchIndex("search_companies", (q) =>
				q
					.search("searchText", queryText.replaceAll(".", " "))
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
		return existing._id;
	}

	return await ctx.db.insert("companies", {
		ownerTokenIdentifier,
		workspaceId,
		domain,
		displayName: domain,
		searchText: domain.replaceAll(/[.-]/gu, " "),
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
