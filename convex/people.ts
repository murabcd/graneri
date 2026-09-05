import { ConvexError, v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import {
	isRelationshipAttendee,
	normalizeCalendarAttendees,
} from "./calendarAttendees";
import { calendarAttendeeValidator } from "./calendarValidators";
import { createResourceAccess, requireOwnedWorkspace } from "./domain";
import {
	CALENDAR_PEOPLE_SYNC_BATCH_SIZE,
	getOrCreatePerson,
	searchWorkspacePeople,
} from "./peopleDomain";

const MAX_PEOPLE_QUERY_LENGTH = 320;
const MAX_PEOPLE_PICKER_RESULTS = 50;

const personSummaryValidator = v.object({
	displayName: v.optional(v.string()),
	email: v.string(),
});

const { requireTokenIdentifier } = createResourceAccess("people");

export const upsertCalendarAttendeeBatch = internalMutation({
	args: {
		attendees: v.array(calendarAttendeeValidator),
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		if (args.attendees.length > CALENDAR_PEOPLE_SYNC_BATCH_SIZE) {
			throw new ConvexError({
				code: "CALENDAR_PEOPLE_SYNC_BATCH_TOO_LARGE",
				message: `Calendar people sync batches are limited to ${CALENDAR_PEOPLE_SYNC_BATCH_SIZE} attendees.`,
			});
		}
		await requireOwnedWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		const attendees = normalizeCalendarAttendees(args.attendees).filter(
			isRelationshipAttendee,
		);
		const now = Date.now();
		for (const attendee of attendees) {
			await getOrCreatePerson({
				attendee,
				source: "calendar",
				ctx,
				now,
				ownerTokenIdentifier: args.ownerTokenIdentifier,
				workspaceId: args.workspaceId,
			});
		}

		return null;
	},
});

const normalizePeopleQuery = (value: string) => {
	const queryText = value.trim().toLowerCase();

	if (queryText.length > MAX_PEOPLE_QUERY_LENGTH) {
		throw new ConvexError({
			code: "INVALID_PEOPLE_QUERY",
			message: `People search is limited to ${MAX_PEOPLE_QUERY_LENGTH} characters.`,
		});
	}

	return queryText;
};

export const listForPicker = query({
	args: {
		query: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.object({
		hasMore: v.boolean(),
		people: v.array(personSummaryValidator),
	}),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const queryText = normalizePeopleQuery(args.query);
		const result = await searchWorkspacePeople(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			queryText,
			MAX_PEOPLE_PICKER_RESULTS,
		);

		return {
			hasMore: result.hasMore,
			people: result.matches.map((person) => ({
				displayName: person.displayName,
				email: person.email,
			})),
		};
	},
});
