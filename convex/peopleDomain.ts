import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { normalizeEmail } from "./calendarAttendees";
import type { CalendarAttendee } from "./calendarTypes";

export const CALENDAR_PEOPLE_SYNC_BATCH_SIZE = 100;

const mergePeopleMatches = (
	exactMatch: Doc<"people"> | null,
	searchMatches: Doc<"people">[],
	limit: number,
) => {
	const matches = new Map<Id<"people">, Doc<"people">>();
	if (exactMatch) {
		matches.set(exactMatch._id, exactMatch);
	}
	for (const person of searchMatches) {
		matches.set(person._id, person);
	}

	return {
		hasMore: searchMatches.length > limit || matches.size > limit,
		matches: [...matches.values()].slice(0, limit),
	};
};

export const searchWorkspacePeople = async (
	ctx: QueryCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	queryText: string,
	limit: number,
) => {
	const exactEmail = queryText ? normalizeEmail(queryText) : null;
	const [exactMatch, searchMatches] = await Promise.all([
		exactEmail
			? ctx.db
					.query("people")
					.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_email", (q) =>
						q
							.eq("ownerTokenIdentifier", ownerTokenIdentifier)
							.eq("workspaceId", workspaceId)
							.eq("email", exactEmail),
					)
					.unique()
			: null,
		queryText
			? ctx.db
					.query("people")
					.withSearchIndex("search_people", (q) =>
						q
							.search("searchText", queryText)
							.eq("ownerTokenIdentifier", ownerTokenIdentifier)
							.eq("workspaceId", workspaceId),
					)
					.take(limit + 1)
			: ctx.db
					.query("people")
					.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_email", (q) =>
						q
							.eq("ownerTokenIdentifier", ownerTokenIdentifier)
							.eq("workspaceId", workspaceId),
					)
					.take(limit + 1),
	]);

	return mergePeopleMatches(exactMatch, searchMatches, limit);
};

export const getOrCreatePerson = async ({
	attendee,
	ctx,
	now,
	ownerTokenIdentifier,
	source,
	workspaceId,
}: {
	attendee: CalendarAttendee;
	source: "calendar" | "note";
	ctx: MutationCtx;
	now: number;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
}) => {
	const existing = await ctx.db
		.query("people")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_email", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("email", attendee.email),
		)
		.unique();
	const displayName = attendee.displayName || existing?.displayName;
	const calendarDiscoveredAt =
		existing?.calendarDiscoveredAt ?? (source === "calendar" ? now : undefined);
	const details = {
		displayName,
		calendarDiscoveredAt,
		searchText: [displayName, attendee.email]
			.filter(Boolean)
			.join(" ")
			.toLowerCase(),
	};

	if (existing) {
		if (
			existing.displayName !== details.displayName ||
			existing.searchText !== details.searchText ||
			existing.calendarDiscoveredAt !== details.calendarDiscoveredAt
		) {
			await ctx.db.patch(existing._id, { ...details, updatedAt: now });
		}
		return existing._id;
	}

	return await ctx.db.insert("people", {
		ownerTokenIdentifier,
		workspaceId,
		email: attendee.email,
		...details,
		createdAt: now,
		updatedAt: now,
	});
};

export const deletePersonIfOrphaned = async (
	ctx: MutationCtx,
	personId: Id<"people">,
) => {
	const person = await ctx.db.get(personId);
	if (!person || person.calendarDiscoveredAt !== undefined) return;

	const remaining = await ctx.db
		.query("noteAttendees")
		.withIndex("by_owner_ws_person_arch_start", (q) =>
			q
				.eq("ownerTokenIdentifier", person.ownerTokenIdentifier)
				.eq("workspaceId", person.workspaceId)
				.eq("personId", personId),
		)
		.first();
	if (!remaining) await ctx.db.delete(personId);
};
