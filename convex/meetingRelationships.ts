import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalQuery, query } from "./_generated/server";
import {
	createResourceAccess,
	requireOwnedWorkspace,
	truncate,
} from "./domain";
import { searchWorkspaceCompanies } from "./companyDomain";
import { searchWorkspacePeople } from "./peopleDomain";

const MAX_ENTITY_MATCHES = 5;
const MAX_MEETING_RESULTS = 25;
const MAX_MEETING_NOTE_TEXT_LENGTH = 40_000;
const MAX_TOTAL_MEETING_NOTE_TEXT_LENGTH = 160_000;
const meetingMatchValidator = v.object({
	endAt: v.string(),
	htmlLink: v.optional(v.string()),
	matchedCompanies: v.array(v.string()),
	matchedPeople: v.array(v.string()),
	meetingUrl: v.optional(v.string()),
	noteId: v.id("notes"),
	provider: v.union(v.literal("google"), v.literal("yandex")),
	searchableText: v.string(),
	searchableTextTruncated: v.boolean(),
	startAt: v.string(),
	title: v.string(),
});

const meetingSearchResultValidator = v.object({
	hasMore: v.boolean(),
	matchedCompanies: v.array(
		v.object({
			displayName: v.string(),
			domain: v.string(),
		}),
	),
	matchedPeople: v.array(
		v.object({
			displayName: v.optional(v.string()),
			email: v.string(),
		}),
	),
	meetings: v.array(meetingMatchValidator),
});

type MeetingAssociationMatch = {
	companyNames: Set<string>;
	eventStartAt: string;
	noteId: Id<"notes">;
	peopleNames: Set<string>;
};

const { requireTokenIdentifier } = createResourceAccess(
	"meeting relationships",
);

const getSearchTerm = (value: string) => {
	const searchTerm = value.trim().toLowerCase();

	if (!searchTerm || searchTerm.length > 320) {
		throw new ConvexError({
			code: "INVALID_MEETING_SEARCH_QUERY",
			message: "Meeting search requires a query up to 320 characters.",
		});
	}

	return searchTerm;
};

const getSearchBoundary = (value: string | undefined, label: string) => {
	if (!value) {
		return undefined;
	}

	const timestamp = new Date(value).getTime();
	if (!Number.isFinite(timestamp)) {
		throw new ConvexError({
			code: "INVALID_MEETING_SEARCH_WINDOW",
			message: `${label} must be an ISO date-time.`,
		});
	}

	return new Date(timestamp).toISOString();
};

const getMeetingResultLimit = (value: number | undefined) => {
	const limit = value ?? 10;
	if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MEETING_RESULTS) {
		throw new ConvexError({
			code: "INVALID_MEETING_SEARCH_LIMIT",
			message: `Meeting search limit must be an integer from 1 to ${MAX_MEETING_RESULTS}.`,
		});
	}
	return limit;
};

const loadPersonAssociations = async ({
	ctx,
	from,
	limit,
	ownerTokenIdentifier,
	person,
	to,
	workspaceId,
}: {
	ctx: QueryCtx;
	from?: string;
	limit: number;
	ownerTokenIdentifier: string;
	person: Doc<"people">;
	to?: string;
	workspaceId: Id<"workspaces">;
}) => {
	const query = ctx.db
		.query("noteAttendees")
		.withIndex("by_owner_ws_person_arch_start", (q) => {
			const range = q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("personId", person._id)
				.eq("noteIsArchived", false);

			if (from && to) {
				return range.gte("eventStartAt", from).lt("eventStartAt", to);
			}
			if (from) {
				return range.gte("eventStartAt", from);
			}
			if (to) {
				return range.lt("eventStartAt", to);
			}
			return range;
		})
		.order("desc");

	return {
		associations: await query.take(limit + 1),
		label: person.displayName ?? person.email,
	};
};

const loadCompanyAssociations = async ({
	company,
	ctx,
	from,
	limit,
	ownerTokenIdentifier,
	to,
	workspaceId,
}: {
	company: Doc<"companies">;
	ctx: QueryCtx;
	from?: string;
	limit: number;
	ownerTokenIdentifier: string;
	to?: string;
	workspaceId: Id<"workspaces">;
}) => {
	const query = ctx.db
		.query("noteCompanies")
		.withIndex("by_owner_ws_company_arch_start", (q) => {
			const range = q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("companyId", company._id)
				.eq("noteIsArchived", false);

			if (from && to) {
				return range.gte("eventStartAt", from).lt("eventStartAt", to);
			}
			if (from) {
				return range.gte("eventStartAt", from);
			}
			if (to) {
				return range.lt("eventStartAt", to);
			}
			return range;
		})
		.order("desc");

	return {
		associations: await query.take(limit + 1),
		label: company.displayName,
	};
};

const mergeAssociation = ({
	companyName,
	eventStartAt,
	matches,
	noteId,
	personName,
}: {
	companyName?: string;
	eventStartAt: string;
	matches: Map<Id<"notes">, MeetingAssociationMatch>;
	noteId: Id<"notes">;
	personName?: string;
}) => {
	const match = matches.get(noteId) ?? {
		companyNames: new Set<string>(),
		eventStartAt,
		noteId,
		peopleNames: new Set<string>(),
	};

	if (companyName) {
		match.companyNames.add(companyName);
	}
	if (personName) {
		match.peopleNames.add(personName);
	}
	matches.set(noteId, match);
};

const meetingSearchArgs = {
	workspaceId: v.id("workspaces"),
	query: v.string(),
	from: v.optional(v.string()),
	to: v.optional(v.string()),
	limit: v.optional(v.number()),
};

const searchMeetingNotesForOwner = async ({
	args,
	ctx,
	ownerTokenIdentifier,
}: {
	args: {
		workspaceId: Id<"workspaces">;
		query: string;
		from?: string;
		to?: string;
		limit?: number;
	};
	ctx: QueryCtx;
	ownerTokenIdentifier: string;
}) => {
	await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
	const searchTerm = getSearchTerm(args.query);
	const from = getSearchBoundary(args.from, "from");
	const to = getSearchBoundary(args.to, "to");

	if (from && to && from >= to) {
		throw new ConvexError({
			code: "INVALID_MEETING_SEARCH_WINDOW",
			message: "Meeting search start must be before its end.",
		});
	}

	const limit = getMeetingResultLimit(args.limit);
	const [peopleResult, companiesResult] = await Promise.all([
		searchWorkspacePeople(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			searchTerm,
			MAX_ENTITY_MATCHES,
		),
		searchWorkspaceCompanies(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			searchTerm,
			MAX_ENTITY_MATCHES,
		),
	]);
	const people = peopleResult.matches;
	const companies = companiesResult.matches;
	const [personGroups, companyGroups] = await Promise.all([
		Promise.all(
			people.map((person) =>
				loadPersonAssociations({
					ctx,
					from,
					limit,
					ownerTokenIdentifier,
					person,
					to,
					workspaceId: args.workspaceId,
				}),
			),
		),
		Promise.all(
			companies.map((company) =>
				loadCompanyAssociations({
					company,
					ctx,
					from,
					limit,
					ownerTokenIdentifier,
					to,
					workspaceId: args.workspaceId,
				}),
			),
		),
	]);
	const matches = new Map<Id<"notes">, MeetingAssociationMatch>();
	let hasMore = peopleResult.hasMore || companiesResult.hasMore;

	for (const group of personGroups) {
		hasMore ||= group.associations.length > limit;
		for (const association of group.associations.slice(0, limit)) {
			mergeAssociation({
				eventStartAt: association.eventStartAt,
				matches,
				noteId: association.noteId,
				personName: group.label,
			});
		}
	}

	for (const group of companyGroups) {
		hasMore ||= group.associations.length > limit;
		for (const association of group.associations.slice(0, limit)) {
			mergeAssociation({
				companyName: group.label,
				eventStartAt: association.eventStartAt,
				matches,
				noteId: association.noteId,
			});
		}
	}

	const orderedMatches = [...matches.values()].sort((left, right) =>
		right.eventStartAt.localeCompare(left.eventStartAt),
	);
	hasMore ||= orderedMatches.length > limit;
	const notes = await Promise.all(
		orderedMatches.slice(0, limit).map(async (match) => ({
			match,
			note: await ctx.db.get(match.noteId),
		})),
	);
	const noteTextLimit = Math.min(
		MAX_MEETING_NOTE_TEXT_LENGTH,
		Math.floor(MAX_TOTAL_MEETING_NOTE_TEXT_LENGTH / Math.max(notes.length, 1)),
	);

	return {
		hasMore,
		matchedCompanies: companies.map((company) => ({
			displayName: company.displayName,
			domain: company.domain,
		})),
		matchedPeople: people.map((person) => ({
			displayName: person.displayName,
			email: person.email,
		})),
		meetings: notes.flatMap(({ match, note }) => {
			if (
				!note ||
				note.isArchived ||
				note.ownerTokenIdentifier !== ownerTokenIdentifier ||
				note.workspaceId !== args.workspaceId ||
				!note.calendarEvent
			) {
				return [];
			}

			return [
				{
					endAt: note.calendarEvent.endAt,
					htmlLink: note.calendarEvent.htmlLink,
					matchedCompanies: [...match.companyNames],
					matchedPeople: [...match.peopleNames],
					meetingUrl: note.calendarEvent.meetingUrl,
					noteId: note._id,
					provider: note.calendarEvent.provider,
					searchableText: truncate(note.searchableText, noteTextLimit),
					searchableTextTruncated: note.searchableText.length > noteTextLimit,
					startAt: note.calendarEvent.startAt,
					title: note.title.trim() || note.calendarEvent.title,
				},
			];
		}),
	};
};

export const searchMeetingNotes = query({
	args: meetingSearchArgs,
	returns: meetingSearchResultValidator,
	handler: async (ctx, args) =>
		await searchMeetingNotesForOwner({
			args,
			ctx,
			ownerTokenIdentifier: await requireTokenIdentifier(ctx),
		}),
});

export const searchMeetingNotesInternal = internalQuery({
	args: {
		...meetingSearchArgs,
		ownerTokenIdentifier: v.string(),
	},
	returns: meetingSearchResultValidator,
	handler: async (ctx, args) =>
		await searchMeetingNotesForOwner({
			args,
			ctx,
			ownerTokenIdentifier: args.ownerTokenIdentifier,
		}),
});
