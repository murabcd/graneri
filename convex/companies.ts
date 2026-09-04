import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import {
	getBusinessEmailDomain,
	isPersonalEmailDomain,
} from "./calendarAttendees";
import {
	getCompanyDisplayName,
	getCompanyFallbackDisplayName,
	getCompanySearchText,
} from "./companyDomain";
import { createResourceAccess, requireOwnedWorkspace } from "./domain";
import {
	matchesRelationshipDirectoryQuery,
	RELATIONSHIP_DIRECTORY_SCAN_LIMIT,
} from "./relationshipDirectory";

const MAX_COMPANIES_QUERY_LENGTH = 320;
const MAX_COMPANY_DIRECTORY_RESULTS = 100;

const companySummaryValidator = v.object({
	displayName: v.string(),
	domain: v.string(),
});

const normalizeCompaniesQuery = (value: string) => {
	const queryText = value.trim().toLowerCase();

	if (queryText.length > MAX_COMPANIES_QUERY_LENGTH) {
		throw new ConvexError({
			code: "INVALID_COMPANIES_QUERY",
			message: `Company search is limited to ${MAX_COMPANIES_QUERY_LENGTH} characters.`,
		});
	}

	return queryText;
};

const { requireTokenIdentifier } = createResourceAccess("companies");

export const listDirectory = query({
	args: {
		query: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.object({
		companies: v.array(companySummaryValidator),
		hasMore: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const queryText = normalizeCompaniesQuery(args.query);
		const [canonicalCompanies, people] = await Promise.all([
			ctx.db
				.query("companies")
				.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_domain", (q) =>
					q
						.eq("ownerTokenIdentifier", ownerTokenIdentifier)
						.eq("workspaceId", args.workspaceId),
				)
				.take(RELATIONSHIP_DIRECTORY_SCAN_LIMIT + 1),
			ctx.db
				.query("people")
				.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_email", (q) =>
					q
						.eq("ownerTokenIdentifier", ownerTokenIdentifier)
						.eq("workspaceId", args.workspaceId),
				)
				.take(RELATIONSHIP_DIRECTORY_SCAN_LIMIT + 1),
		]);
		const companiesByDomain = new Map(
			canonicalCompanies
				.filter((company) => !isPersonalEmailDomain(company.domain))
				.map((company) => {
					const displayName = getCompanyDisplayName(company);
					return [
						company.domain,
						{
							displayName,
							domain: company.domain,
							searchText: getCompanySearchText({
								displayName,
								domain: company.domain,
							}),
						},
					] as const;
				}),
		);
		for (const person of people) {
			const domain = getBusinessEmailDomain(person.email);
			if (domain && !companiesByDomain.has(domain)) {
				const displayName = getCompanyFallbackDisplayName(domain);
				companiesByDomain.set(domain, {
					displayName,
					domain,
					searchText: getCompanySearchText({ displayName, domain }),
				});
			}
		}
		const matchingCompanies = [...companiesByDomain.values()]
			.filter((company) =>
				matchesRelationshipDirectoryQuery(company.searchText, queryText),
			)
			.sort(
				(left, right) =>
					left.displayName.localeCompare(right.displayName) ||
					left.domain.localeCompare(right.domain),
			);
		const companies = matchingCompanies.slice(0, MAX_COMPANY_DIRECTORY_RESULTS);

		return {
			companies: companies.map((company) => ({
				displayName: company.displayName,
				domain: company.domain,
			})),
			hasMore:
				canonicalCompanies.length > RELATIONSHIP_DIRECTORY_SCAN_LIMIT ||
				people.length > RELATIONSHIP_DIRECTORY_SCAN_LIMIT ||
				matchingCompanies.length > MAX_COMPANY_DIRECTORY_RESULTS,
		};
	},
});
