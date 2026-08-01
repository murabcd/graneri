import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import {
	isRelationshipAttendee,
	normalizeCalendarAttendees,
} from "./calendarAttendees";
import type { UpcomingCalendarEvent } from "./calendarTypes";
import { CALENDAR_PEOPLE_SYNC_BATCH_SIZE } from "./peopleDomain";

const collectCalendarPeople = (events: UpcomingCalendarEvent[]) => {
	const attendeesByEmail = new Map<
		string,
		UpcomingCalendarEvent["attendees"][number]
	>();

	for (const event of events) {
		if (!event.isMeeting) {
			continue;
		}
		for (const attendee of normalizeCalendarAttendees(event.attendees)) {
			if (!isRelationshipAttendee(attendee)) {
				continue;
			}
			const existing = attendeesByEmail.get(attendee.email);
			if (!existing?.displayName || attendee.displayName) {
				attendeesByEmail.set(attendee.email, attendee);
			}
		}
	}

	return [...attendeesByEmail.values()];
};

export const scheduleCalendarPeopleSync = async ({
	ctx,
	events,
	ownerTokenIdentifier,
	workspaceId,
}: {
	ctx: ActionCtx;
	events: UpcomingCalendarEvent[];
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
}) => {
	const attendees = collectCalendarPeople(events);
	const batches = Array.from(
		{ length: Math.ceil(attendees.length / CALENDAR_PEOPLE_SYNC_BATCH_SIZE) },
		(_, index) =>
			attendees.slice(
				index * CALENDAR_PEOPLE_SYNC_BATCH_SIZE,
				(index + 1) * CALENDAR_PEOPLE_SYNC_BATCH_SIZE,
			),
	);

	await Promise.all(
		batches.map((batch) =>
			ctx.scheduler.runAfter(0, internal.people.upsertCalendarAttendeeBatch, {
				attendees: batch,
				ownerTokenIdentifier,
				workspaceId,
			}),
		),
	);
};
