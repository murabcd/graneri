import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
	getBusinessEmailDomain,
	isRelationshipAttendee,
	MAX_CALENDAR_ATTENDEES,
	normalizeCalendarAttendees,
} from "./calendarAttendees";
import type { UpcomingCalendarEvent } from "./calendarTypes";
import { deleteCompanyIfOrphaned, getOrCreateCompany } from "./companyDomain";
import { getOrCreatePerson } from "./peopleDomain";

const MAX_CALENDAR_DESCRIPTION_LENGTH = 100_000;
const MAX_CALENDAR_ID_LENGTH = 4_096;
const MAX_CALENDAR_NAME_LENGTH = 320;
const MAX_CALENDAR_TITLE_LENGTH = 1_000;
const MAX_CALENDAR_URL_LENGTH = 8_192;
const MAX_CALENDAR_LOCATION_LENGTH = 2_000;

const requireCalendarString = ({
	label,
	maxLength,
	value,
}: {
	label: string;
	maxLength: number;
	value: string;
}) => {
	const normalized = value.trim();
	if (!normalized || normalized.length > maxLength) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_EVENT",
			message: `${label} is missing or too long.`,
		});
	}
	return normalized;
};

const normalizeOptionalCalendarString = ({
	label,
	maxLength,
	value,
}: {
	label: string;
	maxLength: number;
	value?: string;
}) => {
	if (value === undefined) {
		return undefined;
	}
	const normalized = value.trim();
	if (normalized.length > maxLength) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_EVENT",
			message: `${label} is too long.`,
		});
	}
	return normalized || undefined;
};

const requireCalendarTimestamp = (value: string, label: string) => {
	const timestamp = new Date(value).getTime();
	if (!Number.isFinite(timestamp)) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_EVENT_TIME",
			message: `${label} is invalid.`,
		});
	}
	return new Date(timestamp).toISOString();
};

export const getCalendarEventKey = (event: UpcomingCalendarEvent) =>
	JSON.stringify([
		event.provider,
		requireCalendarString({
			label: "Calendar ID",
			maxLength: MAX_CALENDAR_ID_LENGTH,
			value: event.calendarId,
		}),
		requireCalendarString({
			label: "Event ID",
			maxLength: MAX_CALENDAR_ID_LENGTH,
			value: event.id,
		}),
		requireCalendarTimestamp(event.startAt, "Calendar event start"),
	]);

const toCalendarEventSnapshot = (event: UpcomingCalendarEvent) => ({
	calendarId: requireCalendarString({
		label: "Calendar ID",
		maxLength: MAX_CALENDAR_ID_LENGTH,
		value: event.calendarId,
	}),
	calendarName: requireCalendarString({
		label: "Calendar name",
		maxLength: MAX_CALENDAR_NAME_LENGTH,
		value: event.calendarName,
	}),
	description: normalizeOptionalCalendarString({
		label: "Calendar event description",
		maxLength: MAX_CALENDAR_DESCRIPTION_LENGTH,
		value: event.description,
	}),
	endAt: requireCalendarTimestamp(event.endAt, "Calendar event end"),
	htmlLink: normalizeOptionalCalendarString({
		label: "Calendar event link",
		maxLength: MAX_CALENDAR_URL_LENGTH,
		value: event.htmlLink,
	}),
	id: requireCalendarString({
		label: "Event ID",
		maxLength: MAX_CALENDAR_ID_LENGTH,
		value: event.id,
	}),
	isAllDay: event.isAllDay,
	isMeeting: event.isMeeting,
	isRecurring: event.isRecurring,
	key: getCalendarEventKey(event),
	location: normalizeOptionalCalendarString({
		label: "Calendar event location",
		maxLength: MAX_CALENDAR_LOCATION_LENGTH,
		value: event.location,
	}),
	meetingUrl: normalizeOptionalCalendarString({
		label: "Calendar meeting link",
		maxLength: MAX_CALENDAR_URL_LENGTH,
		value: event.meetingUrl,
	}),
	provider: event.provider,
	providerEventId: requireCalendarString({
		label: "Provider event ID",
		maxLength: MAX_CALENDAR_ID_LENGTH,
		value: event.providerEventId,
	}),
	recurrenceId: normalizeOptionalCalendarString({
		label: "Recurrence ID",
		maxLength: MAX_CALENDAR_ID_LENGTH,
		value: event.recurrenceId,
	}),
	startAt: requireCalendarTimestamp(event.startAt, "Calendar event start"),
	title: requireCalendarString({
		label: "Calendar event title",
		maxLength: MAX_CALENDAR_TITLE_LENGTH,
		value: event.title,
	}),
});

const requireValidCalendarEvent = (event: UpcomingCalendarEvent) => {
	const snapshot = toCalendarEventSnapshot(event);
	const startAt = new Date(snapshot.startAt).getTime();
	const endAt = new Date(snapshot.endAt).getTime();

	if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_EVENT_TIME",
			message: "Calendar event time is invalid.",
		});
	}

	return {
		attendees: normalizeCalendarAttendees(event.attendees),
		snapshot,
	};
};

export const createCalendarNoteRelationships = async ({
	ctx,
	event,
	noteId,
	now,
	ownerTokenIdentifier,
	workspaceId,
}: {
	ctx: MutationCtx;
	event: UpcomingCalendarEvent;
	noteId: Id<"notes">;
	now: number;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
}) => {
	const { attendees, snapshot } = requireValidCalendarEvent(event);
	const companyIds = new Set<Id<"companies">>();
	const companyIdByDomain = new Map<string, Id<"companies">>();

	for (const attendee of attendees) {
		let personId: Id<"people"> | undefined;
		let companyId: Id<"companies"> | undefined;

		if (isRelationshipAttendee(attendee)) {
			personId = await getOrCreatePerson({
				attendee,
				ctx,
				now,
				ownerTokenIdentifier,
				workspaceId,
			});
			const businessDomain = getBusinessEmailDomain(attendee.email);

			if (businessDomain) {
				companyId = companyIdByDomain.get(businessDomain);
				if (!companyId) {
					companyId = await getOrCreateCompany({
						ctx,
						domain: businessDomain,
						now,
						ownerTokenIdentifier,
						workspaceId,
					});
					companyIdByDomain.set(businessDomain, companyId);
				}
				companyIds.add(companyId);
			}
		}

		await ctx.db.insert("noteAttendees", {
			ownerTokenIdentifier,
			workspaceId,
			noteId,
			personId,
			companyId,
			email: attendee.email,
			displayName: attendee.displayName,
			responseStatus: attendee.responseStatus,
			isOrganizer: attendee.isOrganizer,
			isSelf: attendee.isSelf,
			eventStartAt: snapshot.startAt,
			noteIsArchived: false,
			createdAt: now,
		});
	}

	await Promise.all(
		[...companyIds].map((companyId) =>
			ctx.db.insert("noteCompanies", {
				ownerTokenIdentifier,
				workspaceId,
				noteId,
				companyId,
				eventStartAt: snapshot.startAt,
				noteIsArchived: false,
				createdAt: now,
			}),
		),
	);

	return snapshot;
};
const loadCalendarNoteRelationships = async (
	ctx: MutationCtx,
	note: Pick<Doc<"notes">, "_id" | "ownerTokenIdentifier" | "workspaceId">,
) => {
	const [attendees, companies] = await Promise.all([
		ctx.db
			.query("noteAttendees")
			.withIndex("by_owner_ws_note", (q) =>
				q
					.eq("ownerTokenIdentifier", note.ownerTokenIdentifier)
					.eq("workspaceId", note.workspaceId)
					.eq("noteId", note._id),
			)
			.take(MAX_CALENDAR_ATTENDEES + 1),
		ctx.db
			.query("noteCompanies")
			.withIndex("by_owner_ws_note", (q) =>
				q
					.eq("ownerTokenIdentifier", note.ownerTokenIdentifier)
					.eq("workspaceId", note.workspaceId)
					.eq("noteId", note._id),
			)
			.take(MAX_CALENDAR_ATTENDEES + 1),
	]);

	if (
		attendees.length > MAX_CALENDAR_ATTENDEES ||
		companies.length > MAX_CALENDAR_ATTENDEES
	) {
		throw new ConvexError({
			code: "CALENDAR_RELATIONSHIP_INVARIANT_VIOLATION",
			message: "Calendar note relationships exceed the supported bound.",
		});
	}

	return { attendees, companies };
};

export const setCalendarNoteRelationshipsArchived = async ({
	ctx,
	isArchived,
	note,
}: {
	ctx: MutationCtx;
	isArchived: boolean;
	note: Doc<"notes">;
}) => {
	const { attendees, companies } = await loadCalendarNoteRelationships(
		ctx,
		note,
	);

	await Promise.all([
		...attendees.map((attendee) =>
			ctx.db.patch(attendee._id, { noteIsArchived: isArchived }),
		),
		...companies.map((company) =>
			ctx.db.patch(company._id, { noteIsArchived: isArchived }),
		),
	]);
};

export const removeCalendarNoteRelationships = async (
	ctx: MutationCtx,
	note: Doc<"notes">,
) => {
	const { attendees, companies } = await loadCalendarNoteRelationships(
		ctx,
		note,
	);
	const personIds = new Set(
		attendees.flatMap((attendee) =>
			attendee.personId ? [attendee.personId] : [],
		),
	);
	const companyIds = new Set(companies.map((company) => company.companyId));

	await Promise.all([
		...attendees.map((attendee) => ctx.db.delete(attendee._id)),
		...companies.map((company) => ctx.db.delete(company._id)),
	]);

	for (const personId of personIds) {
		const remaining = await ctx.db
			.query("noteAttendees")
			.withIndex("by_owner_ws_person_arch_start", (q) =>
				q
					.eq("ownerTokenIdentifier", note.ownerTokenIdentifier)
					.eq("workspaceId", note.workspaceId)
					.eq("personId", personId),
			)
			.first();

		if (!remaining) {
			await ctx.db.delete(personId);
		}
	}

	for (const companyId of companyIds) {
		await deleteCompanyIfOrphaned({
			companyId,
			ctx,
			ownerTokenIdentifier: note.ownerTokenIdentifier,
			workspaceId: note.workspaceId,
		});
	}
};
