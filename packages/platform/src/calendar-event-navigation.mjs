const calendarEventRequestSearchParam = "calendarEventRequestId";
const maxCalendarEventPayloadLength = 256_000;
const maxCalendarAttendees = 250;

const attendeeResponseStatuses = new Set([
	"accepted",
	"declined",
	"needs_action",
	"tentative",
	"unknown",
]);

const isRecord = (value) =>
	typeof value === "object" && value !== null && !Array.isArray(value);

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

const normalizeAttendee = (value) => {
	if (!isRecord(value)) {
		return null;
	}

	const email = normalizeRequiredString(value.email)?.toLowerCase();
	const responseStatus = normalizeRequiredString(value.responseStatus);

	if (
		!email?.includes("@") ||
		typeof value.isOrganizer !== "boolean" ||
		typeof value.isSelf !== "boolean" ||
		!responseStatus ||
		!attendeeResponseStatuses.has(responseStatus)
	) {
		return null;
	}

	return {
		displayName: normalizeOptionalString(value.displayName),
		email,
		isOrganizer: value.isOrganizer,
		isSelf: value.isSelf,
		responseStatus,
	};
};

export const normalizeCalendarEventPayload = (value) => {
	if (!isRecord(value) || !Array.isArray(value.attendees)) {
		return null;
	}

	if (value.attendees.length > maxCalendarAttendees) {
		return null;
	}

	const attendees = value.attendees.map(normalizeAttendee);
	if (attendees.some((attendee) => attendee === null)) {
		return null;
	}

	const id = normalizeRequiredString(value.id);
	const calendarId = normalizeRequiredString(value.calendarId);
	const calendarName = normalizeRequiredString(value.calendarName);
	const providerEventId = normalizeRequiredString(value.providerEventId);
	const title = normalizeRequiredString(value.title);
	const startAt = normalizeTimestamp(value.startAt);
	const endAt = normalizeTimestamp(value.endAt);

	if (
		!id ||
		!calendarId ||
		!calendarName ||
		!providerEventId ||
		!title ||
		!startAt ||
		!endAt ||
		endAt < startAt ||
		(value.provider !== "google" && value.provider !== "yandex") ||
		typeof value.isAllDay !== "boolean" ||
		typeof value.isMeeting !== "boolean" ||
		typeof value.isRecurring !== "boolean"
	) {
		return null;
	}

	const event = {
		attendees,
		calendarId,
		calendarName,
		description: normalizeOptionalString(value.description),
		endAt,
		htmlLink: normalizeOptionalString(value.htmlLink),
		id,
		isAllDay: value.isAllDay,
		isMeeting: value.isMeeting,
		isRecurring: value.isRecurring,
		location: normalizeOptionalString(value.location),
		meetingUrl: normalizeOptionalString(value.meetingUrl),
		provider: value.provider,
		providerEventId,
		recurrenceId: normalizeOptionalString(value.recurrenceId),
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
