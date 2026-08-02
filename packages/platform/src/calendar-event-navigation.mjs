import { z } from "zod";

const calendarEventRequestSearchParam = "calendarEventRequestId";
const maxCalendarEventPayloadLength = 256_000;
const maxCalendarAttendees = 250;

const attendeeSchema = z.strictObject({
	displayName: z.string().optional(),
	email: z.string(),
	isOrganizer: z.boolean(),
	isSelf: z.boolean(),
	responseStatus: z.enum([
		"accepted",
		"declined",
		"needs_action",
		"tentative",
		"unknown",
	]),
});

const recurrenceEndSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("never") }),
	z.strictObject({
		count: z.number().int().positive(),
		kind: z.literal("after_count"),
	}),
	z.strictObject({ date: z.string(), kind: z.literal("on_date") }),
]);

const recurrenceSchema = z.strictObject({
	end: recurrenceEndSchema,
	frequency: z.enum(["daily", "weekly", "monthly", "yearly", "custom"]),
	interval: z.number().int().positive(),
	weekdays: z.array(z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"])),
});

const calendarEventSchema = z.strictObject({
	attendees: z.array(attendeeSchema).max(maxCalendarAttendees),
	calendarId: z.string(),
	calendarName: z.string(),
	canDelete: z.boolean(),
	canEdit: z.boolean(),
	canMove: z.boolean(),
	canRemove: z.boolean(),
	description: z.string().optional(),
	endAt: z.string(),
	guestPermissions: z.enum(["none", "invite", "manage"]),
	htmlLink: z.string().optional(),
	id: z.string(),
	isAllDay: z.boolean(),
	isMeeting: z.boolean(),
	isRecurring: z.boolean(),
	location: z.string().optional(),
	meetingUrl: z.string().optional(),
	provider: z.enum(["google", "yandex"]),
	providerEventId: z.string(),
	recurrence: recurrenceSchema.optional(),
	recurrenceId: z.string().optional(),
	seriesProviderEventId: z.string().optional(),
	startAt: z.string(),
	title: z.string(),
});

const normalizeRequiredString = (value) => {
	const normalized = typeof value === "string" ? value.trim() : "";
	return normalized || null;
};

const normalizeOptionalString = (value) =>
	typeof value === "string" && value.trim() ? value.trim() : undefined;

const normalizeTimestamp = (value) => {
	const timestamp = Date.parse(normalizeRequiredString(value) ?? "");
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const normalizeAttendee = (attendee) => {
	const email = normalizeRequiredString(attendee.email)?.toLowerCase();

	if (!email?.includes("@")) {
		return null;
	}

	return {
		displayName: normalizeOptionalString(attendee.displayName),
		email,
		isOrganizer: attendee.isOrganizer,
		isSelf: attendee.isSelf,
		responseStatus: attendee.responseStatus,
	};
};

const normalizeRecurrenceEnd = (end) => {
	if (end.kind === "never") {
		return { kind: "never" };
	}

	if (end.kind === "after_count") {
		return { count: end.count, kind: "after_count" };
	}

	if (/^\d{4}-\d{2}-\d{2}$/u.test(end.date)) {
		const [year, month, day] = end.date.split("-").map(Number);
		const date = new Date(Date.UTC(year, month - 1, day));

		if (
			date.getUTCFullYear() === year &&
			date.getUTCMonth() === month - 1 &&
			date.getUTCDate() === day
		) {
			return { date: end.date, kind: "on_date" };
		}
	}

	return null;
};

const normalizeRecurrence = (recurrence) => {
	if (recurrence === undefined) {
		return undefined;
	}
	const end = normalizeRecurrenceEnd(recurrence.end);
	if (!end) return null;

	return {
		end,
		frequency: recurrence.frequency,
		interval: recurrence.interval,
		weekdays: [...new Set(recurrence.weekdays)],
	};
};

export const normalizeCalendarEventPayload = (value) => {
	const result = calendarEventSchema.safeParse(value);
	if (!result.success) {
		return null;
	}
	const calendarEvent = result.data;

	const attendees = calendarEvent.attendees.map(normalizeAttendee);
	if (attendees.some((attendee) => attendee === null)) {
		return null;
	}

	const id = normalizeRequiredString(calendarEvent.id);
	const calendarId = normalizeRequiredString(calendarEvent.calendarId);
	const calendarName = normalizeRequiredString(calendarEvent.calendarName);
	const providerEventId = normalizeRequiredString(
		calendarEvent.providerEventId,
	);
	const title = normalizeRequiredString(calendarEvent.title);
	const startAt = normalizeTimestamp(calendarEvent.startAt);
	const endAt = normalizeTimestamp(calendarEvent.endAt);
	const recurrence = normalizeRecurrence(calendarEvent.recurrence);

	if (
		!id ||
		!calendarId ||
		!calendarName ||
		!providerEventId ||
		!title ||
		!startAt ||
		!endAt ||
		recurrence === null ||
		endAt < startAt
	) {
		return null;
	}

	const event = {
		attendees,
		canDelete: calendarEvent.canDelete,
		canEdit: calendarEvent.canEdit,
		guestPermissions: calendarEvent.guestPermissions,
		canMove: calendarEvent.canMove,
		canRemove: calendarEvent.canRemove,
		calendarId,
		calendarName,
		description: normalizeOptionalString(calendarEvent.description),
		endAt,
		htmlLink: normalizeOptionalString(calendarEvent.htmlLink),
		id,
		isAllDay: calendarEvent.isAllDay,
		isMeeting: calendarEvent.isMeeting,
		isRecurring: calendarEvent.isRecurring,
		location: normalizeOptionalString(calendarEvent.location),
		meetingUrl: normalizeOptionalString(calendarEvent.meetingUrl),
		provider: calendarEvent.provider,
		providerEventId,
		recurrence,
		recurrenceId: normalizeOptionalString(calendarEvent.recurrenceId),
		seriesProviderEventId: normalizeOptionalString(
			calendarEvent.seriesProviderEventId,
		),
		startAt,
		title,
	};

	return JSON.stringify(event).length <= maxCalendarEventPayloadLength
		? event
		: null;
};

const normalizeCalendarEventRequestId = (value) => {
	const requestId = typeof value === "string" ? value.trim() : "";
	return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
		requestId,
	)
		? requestId
		: null;
};

export const appendCalendarEventRequestSearchParam = ({
	requestId,
	searchParams,
}) => {
	const normalizedRequestId = normalizeCalendarEventRequestId(requestId);
	if (!normalizedRequestId) {
		throw new TypeError("Calendar event request ID is invalid.");
	}
	searchParams.set(calendarEventRequestSearchParam, normalizedRequestId);
};

export const getCalendarEventRequestIdFromSearchParams = (searchParams) =>
	normalizeCalendarEventRequestId(
		searchParams.get(calendarEventRequestSearchParam),
	);
