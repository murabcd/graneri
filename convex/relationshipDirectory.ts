import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import { type QueryCtx, query } from "./_generated/server";
import { isPersonalEmailDomain } from "./calendarAttendees";
import { getCompanyDisplayName } from "./companyDomain";
import { createResourceAccess, requireOwnedWorkspace } from "./domain";
import {
	type DirectoryEntry,
	directoryEntryValidator,
	normalizeRelationshipSearchText,
	RELATIONSHIP_DIRECTORY_PAGE_SIZE,
} from "./relationshipDirectoryModel";

const directoryArgsValidator = v.object({
	paginationOpts: paginationOptsValidator,
	query: v.string(),
	workspaceId: v.id("workspaces"),
});
const directoryPageValidator = paginationResultValidator(
	directoryEntryValidator,
);

type DirectoryArgs = Infer<typeof directoryArgsValidator>;
const { requireTokenIdentifier } = createResourceAccess(
	"relationship directories",
);

const prepareDirectoryRead = async (ctx: QueryCtx, args: DirectoryArgs) => {
	const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
	await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
	if (args.query.trim().length > 320) {
		throw new ConvexError({
			code: "INVALID_DIRECTORY_QUERY",
			message: "Directory search is limited to 320 characters.",
		});
	}
	if (
		!Number.isInteger(args.paginationOpts.numItems) ||
		args.paginationOpts.numItems < 1 ||
		args.paginationOpts.numItems > RELATIONSHIP_DIRECTORY_PAGE_SIZE
	) {
		throw new ConvexError({
			code: "INVALID_DIRECTORY_PAGE_SIZE",
			message: `Directory pages must contain between 1 and ${RELATIONSHIP_DIRECTORY_PAGE_SIZE} records.`,
		});
	}
	const terms = normalizeRelationshipSearchText(args.query)
		.split(" ")
		.filter(Boolean);
	const matches = (entry: DirectoryEntry) => {
		const text = normalizeRelationshipSearchText(
			`${entry.label} ${entry.subtitle}`,
		);
		return terms.every((term) => text.includes(term));
	};
	return { ownerTokenIdentifier, matches };
};

export const listPeople = query({
	args: directoryArgsValidator.fields,
	returns: directoryPageValidator,
	handler: async (ctx, args) => {
		const { ownerTokenIdentifier, matches } = await prepareDirectoryRead(
			ctx,
			args,
		);
		const result = await ctx.db
			.query("people")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_email", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.paginate(args.paginationOpts);
		const entries = await Promise.all(
			result.page.map(async (person) => {
				const entry = {
					key: person.email,
					label: person.displayName?.trim() || person.email,
					subtitle: person.email,
				};
				if (!matches(entry)) return [];
				const association = await ctx.db
					.query("noteAttendees")
					.withIndex("by_owner_ws_person_arch_start", (q) =>
						q
							.eq("ownerTokenIdentifier", ownerTokenIdentifier)
							.eq("workspaceId", args.workspaceId)
							.eq("personId", person._id)
							.eq("noteIsArchived", false),
					)
					.first();
				return association ? [entry] : [];
			}),
		);
		return { ...result, page: entries.flat() };
	},
});

export const listCompanies = query({
	args: directoryArgsValidator.fields,
	returns: directoryPageValidator,
	handler: async (ctx, args) => {
		const { ownerTokenIdentifier, matches } = await prepareDirectoryRead(
			ctx,
			args,
		);
		const result = await ctx.db
			.query("companies")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_domain", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.paginate(args.paginationOpts);
		const entries = await Promise.all(
			result.page.map(async (company) => {
				if (isPersonalEmailDomain(company.domain)) return [];
				const entry = {
					key: company.domain,
					label: getCompanyDisplayName(company),
					subtitle: company.domain,
				};
				if (!matches(entry)) return [];
				const association = await ctx.db
					.query("noteCompanies")
					.withIndex("by_owner_ws_company_arch_start", (q) =>
						q
							.eq("ownerTokenIdentifier", ownerTokenIdentifier)
							.eq("workspaceId", args.workspaceId)
							.eq("companyId", company._id)
							.eq("noteIsArchived", false),
					)
					.first();
				return association ? [entry] : [];
			}),
		);
		return { ...result, page: entries.flat() };
	},
});
