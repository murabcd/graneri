"use node";

import { ConvexError } from "convex/values";
import type {
	CalendarEventDetailsInput,
	CalendarEventsFetchResult,
	CalendarSource,
	UpcomingCalendarEvent,
	UpdateCalendarEventInput,
} from "./calendarTypes";
import {
	fetchGoogleJsonWithRetry,
	fetchGoogleResponseWithRetry,
	GOOGLE_CALENDAR_MANAGE_SCOPE,
	GOOGLE_CALENDAR_SCOPE,
	GOOGLE_CALENDAR_WRITE_SCOPE,
	type GoogleAuthContext,
	getGoogleAccessToken,
} from "./googleAuth";

type GoogleCalendarListResponse = {
	items?: GoogleCalendarListEntry[];
};

type GoogleCalendarListEntry = {
	accessRole?: string;
	backgroundColor?: string;
	hidden?: boolean;
	id: string;
	selected?: boolean;
	summary?: string;
};

type GoogleCalendarEventsResponse = {
	items?: GoogleCalendarEvent[];
};

type GoogleCalendarEvent = {
	attendees?: Array<{
		email?: string;
		responseStatus?: string;
		self?: boolean;
	}>;
	conferenceData?: {
		entryPoints?: Array<{
			entryPointType?: string;
			uri?: string;
		}>;
	};
	description?: string;
	end?: GoogleCalendarDateTime;
	eventType?: string;
	hangoutLink?: string;
	htmlLink?: string;
	iCalUID?: string;
	id: string;
	location?: string;
	originalStartTime?: GoogleCalendarDateTime;
	recurrence?: string[];
	recurringEventId?: string;
	start?: GoogleCalendarDateTime;
	status?: string;
	summary?: string;
};

type GoogleCalendarDateTime = {
	date?: string;
	dateTime?: string;
};

const isVisibleCalendar = (calendar: GoogleCalendarListEntry) =>
	Boolean(calendar.id) &&
	calendar.hidden !== true &&
	calendar.selected !== false &&
	calendar.accessRole !== "freeBusyReader";

const canCreateEvents = (calendar: GoogleCalendarListEntry) =>
	calendar.accessRole === "owner" || calendar.accessRole === "writer";

const requireCalendarColor = (calendar: GoogleCalendarListEntry) => {
	const color = calendar.backgroundColor?.trim();

	if (!color || !/^#[0-9a-f]{6}$/iu.test(color)) {
		throw new Error(
			`Google calendar "${calendar.id}" did not expose a valid color.`,
		);
	}

	return color;
};

const hasDeclinedEvent = (event: GoogleCalendarEvent) =>
	event.attendees?.some(
		(attendee) =>
			attendee.self === true && attendee.responseStatus === "declined",
	) ?? false;

const isIgnoredEventType = (event: GoogleCalendarEvent) =>
	event.eventType === "focusTime" ||
	event.eventType === "outOfOffice" ||
	event.eventType === "workingLocation";

const getMeetingUrl = (event: GoogleCalendarEvent) =>
	event.hangoutLink ??
	event.conferenceData?.entryPoints?.find(
		(entryPoint) =>
			entryPoint.entryPointType === "video" && Boolean(entryPoint.uri),
	)?.uri;

const isMeetingEvent = ({
	attendees,
	meetingUrl,
}: {
	attendees?: GoogleCalendarEvent["attendees"];
	meetingUrl?: string;
}) =>
	Boolean(meetingUrl) ||
	(attendees?.some((attendee) => attendee.self !== true) ?? false);

const toDate = (value: GoogleCalendarDateTime | undefined, isEnd: boolean) => {
	if (!value) {
		return null;
	}

	if (value.dateTime) {
		return new Date(value.dateTime);
	}

	if (value.date) {
		return isEnd
			? new Date(new Date(`${value.date}T00:00:00`).getTime() - 1)
			: new Date(`${value.date}T00:00:00`);
	}

	return null;
};

const normalizeEvent = (
	calendar: GoogleCalendarListEntry,
	event: GoogleCalendarEvent,
	minimumEndAt: number,
): UpcomingCalendarEvent | null => {
	if (!event.id || event.status === "cancelled") {
		return null;
	}

	if (hasDeclinedEvent(event) || isIgnoredEventType(event)) {
		return null;
	}

	const startAt = toDate(event.start, false);
	const endAt = toDate(event.end, true) ?? startAt;

	if (!startAt || !endAt || endAt.getTime() < minimumEndAt) {
		return null;
	}

	const meetingUrl = getMeetingUrl(event);

	return {
		calendarId: calendar.id,
		calendarName: calendar.summary || "Calendar",
		description: event.description?.trim() || undefined,
		endAt: endAt.toISOString(),
		htmlLink: event.htmlLink,
		id: event.iCalUID ?? event.id,
		isAllDay: Boolean(event.start?.date && !event.start?.dateTime),
		isMeeting: isMeetingEvent({
			attendees: event.attendees,
			meetingUrl,
		}),
		isRecurring: Boolean(
			event.recurringEventId || (event.recurrence?.length ?? 0) > 0,
		),
		location: event.location?.trim() || undefined,
		meetingUrl,
		provider: "google",
		providerEventId: event.id,
		recurrenceId: event.originalStartTime
			? (toDate(event.originalStartTime, false)?.toISOString() ?? undefined)
			: undefined,
		startAt: startAt.toISOString(),
		title: event.summary?.trim() || "Untitled event",
	};
};

export const fetchGoogleCalendarEvents = async ({
	authContext,
	eventLimit,
	minimumEndAt,
	timeMax,
	timeMin,
}: {
	authContext: GoogleAuthContext;
	eventLimit: number;
	minimumEndAt: number;
	timeMax: string;
	timeMin: string;
}): Promise<CalendarEventsFetchResult> => {
	const googleTokens = await getGoogleAccessToken(authContext);

	if (
		!googleTokens?.accessToken ||
		!googleTokens.scopes.includes(GOOGLE_CALENDAR_SCOPE)
	) {
		return {
			calendars: [],
			connectedCalendarCount: 0,
			events: [],
		};
	}

	const calendarListUrl = new URL(
		"https://www.googleapis.com/calendar/v3/users/me/calendarList",
	);
	calendarListUrl.searchParams.set("colorRgbFormat", "true");
	calendarListUrl.searchParams.set("minAccessRole", "reader");
	calendarListUrl.searchParams.set("showDeleted", "false");
	const calendarList =
		await fetchGoogleJsonWithRetry<GoogleCalendarListResponse>(
			authContext,
			googleTokens,
			calendarListUrl,
		);
	const providerCalendars = (calendarList.items ?? []).filter(
		isVisibleCalendar,
	);
	const calendars = providerCalendars.map(
		(calendar) =>
			({
				canCreateEvents:
					googleTokens.scopes.includes(GOOGLE_CALENDAR_WRITE_SCOPE) &&
					canCreateEvents(calendar),
				color: requireCalendarColor(calendar),
				id: calendar.id,
				name: calendar.summary || "Calendar",
				provider: "google",
			}) satisfies CalendarSource,
	);

	const perCalendarEvents = await Promise.all(
		providerCalendars.map(async (calendar) => {
			const eventsUrl = new URL(
				`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`,
			);
			eventsUrl.searchParams.set("maxResults", String(eventLimit));
			eventsUrl.searchParams.set("orderBy", "startTime");
			eventsUrl.searchParams.set("showDeleted", "false");
			eventsUrl.searchParams.set("singleEvents", "true");
			eventsUrl.searchParams.set("timeMax", timeMax);
			eventsUrl.searchParams.set("timeMin", timeMin);

			const response =
				await fetchGoogleJsonWithRetry<GoogleCalendarEventsResponse>(
					authContext,
					googleTokens,
					eventsUrl,
				);

			return (response.items ?? [])
				.map((event) => normalizeEvent(calendar, event, minimumEndAt))
				.filter((event): event is UpcomingCalendarEvent => event !== null);
		}),
	);

	return {
		calendars,
		connectedCalendarCount: calendars.length,
		events: perCalendarEvents.flat(),
	};
};

const getWritableCalendar = async ({
	authContext,
	calendarId,
}: {
	authContext: GoogleAuthContext;
	calendarId: string;
}) => {
	const googleTokens = await getGoogleAccessToken(authContext);

	if (
		!googleTokens?.accessToken ||
		!googleTokens.scopes.includes(GOOGLE_CALENDAR_SCOPE) ||
		!googleTokens.scopes.includes(GOOGLE_CALENDAR_WRITE_SCOPE)
	) {
		throw new ConvexError({
			code: "GOOGLE_CALENDAR_WRITE_NOT_CONNECTED",
			message: "Reconnect Google Calendar to manage events.",
		});
	}

	const calendarListUrl = new URL(
		"https://www.googleapis.com/calendar/v3/users/me/calendarList",
	);
	calendarListUrl.searchParams.set("minAccessRole", "writer");
	calendarListUrl.searchParams.set("showDeleted", "false");
	const calendarList =
		await fetchGoogleJsonWithRetry<GoogleCalendarListResponse>(
			authContext,
			googleTokens,
			calendarListUrl,
		);
	const calendar = (calendarList.items ?? []).find(
		(candidate) =>
			candidate.id === calendarId &&
			isVisibleCalendar(candidate) &&
			canCreateEvents(candidate),
	);

	if (!calendar) {
		throw new ConvexError({
			code: "CALENDAR_NOT_WRITABLE",
			message: "The selected calendar does not allow event changes.",
		});
	}

	return { calendar, googleTokens };
};

export const createGoogleCalendarEvent = async ({
	authContext,
	input,
}: {
	authContext: GoogleAuthContext;
	input: CalendarEventDetailsInput;
}) => {
	const { calendar, googleTokens } = await getWritableCalendar({
		authContext,
		calendarId: input.calendarId,
	});
	const eventsUrl = new URL(
		`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`,
	);

	if (input.guests.length > 0) {
		eventsUrl.searchParams.set("sendUpdates", "all");
	}

	const body =
		input.time.kind === "all_day"
			? {
					attendees: input.guests.map((email) => ({ email })),
					description: input.description,
					end: { date: input.time.endDate },
					location: input.location,
					start: { date: input.time.startDate },
					summary: input.title,
				}
			: {
					attendees: input.guests.map((email) => ({ email })),
					description: input.description,
					end: { dateTime: input.time.endAt },
					location: input.location,
					start: { dateTime: input.time.startAt },
					summary: input.title,
				};
	const createdEvent = await fetchGoogleJsonWithRetry<{ id: string }>(
		authContext,
		googleTokens,
		eventsUrl,
		{
			body: JSON.stringify(body),
			headers: { "Content-Type": "application/json; charset=utf-8" },
			method: "POST",
		},
	);

	return { id: createdEvent.id };
};

const getEventBody = (input: UpdateCalendarEventInput) =>
	input.time.kind === "all_day"
		? {
				description: input.description ?? "",
				end: { date: input.time.endDate },
				location: input.location ?? "",
				start: { date: input.time.startDate },
				summary: input.title,
			}
		: {
				description: input.description ?? "",
				end: { dateTime: input.time.endAt },
				location: input.location ?? "",
				start: { dateTime: input.time.startAt },
				summary: input.title,
			};

export const updateGoogleCalendarEvent = async ({
	authContext,
	input,
}: {
	authContext: GoogleAuthContext;
	input: UpdateCalendarEventInput;
}) => {
	const { calendar, googleTokens } = await getWritableCalendar({
		authContext,
		calendarId: input.calendarId,
	});
	const eventUrl = new URL(
		`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(input.providerEventId)}`,
	);
	eventUrl.searchParams.set("sendUpdates", "all");
	await fetchGoogleJsonWithRetry<GoogleCalendarEvent>(
		authContext,
		googleTokens,
		eventUrl,
		{
			body: JSON.stringify(getEventBody(input)),
			headers: { "Content-Type": "application/json; charset=utf-8" },
			method: "PATCH",
		},
	);
	return null;
};

export const deleteGoogleCalendarEvent = async ({
	authContext,
	calendarId,
	providerEventId,
}: {
	authContext: GoogleAuthContext;
	calendarId: string;
	providerEventId: string;
}) => {
	const { calendar, googleTokens } = await getWritableCalendar({
		authContext,
		calendarId,
	});
	const eventUrl = new URL(
		`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(providerEventId)}`,
	);
	eventUrl.searchParams.set("sendUpdates", "all");
	await fetchGoogleResponseWithRetry(authContext, googleTokens, eventUrl, {
		method: "DELETE",
	});
	return null;
};

export const createGoogleCalendar = async ({
	authContext,
	color,
	name,
}: {
	authContext: GoogleAuthContext;
	color: string;
	name: string;
}) => {
	const googleTokens = await getGoogleAccessToken(authContext);

	if (
		!googleTokens?.accessToken ||
		!googleTokens.scopes.includes(GOOGLE_CALENDAR_SCOPE) ||
		!googleTokens.scopes.includes(GOOGLE_CALENDAR_WRITE_SCOPE) ||
		!googleTokens.scopes.includes(GOOGLE_CALENDAR_MANAGE_SCOPE)
	) {
		throw new ConvexError({
			code: "GOOGLE_CALENDAR_MANAGE_NOT_CONNECTED",
			message: "Reconnect Google Calendar to allow calendar creation.",
		});
	}

	const createdCalendar = await fetchGoogleJsonWithRetry<{ id: string }>(
		authContext,
		googleTokens,
		new URL("https://www.googleapis.com/calendar/v3/calendars"),
		{
			body: JSON.stringify({ summary: name }),
			headers: { "Content-Type": "application/json; charset=utf-8" },
			method: "POST",
		},
	);

	if (!createdCalendar.id) {
		throw new Error("Google Calendar did not return the created calendar.");
	}

	const calendarListEntryUrl = new URL(
		`https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(createdCalendar.id)}`,
	);
	calendarListEntryUrl.searchParams.set("colorRgbFormat", "true");

	try {
		await fetchGoogleJsonWithRetry<Record<string, unknown>>(
			authContext,
			googleTokens,
			calendarListEntryUrl,
			{
				body: JSON.stringify({
					backgroundColor: color,
					foregroundColor: "#ffffff",
					selected: true,
				}),
				headers: { "Content-Type": "application/json; charset=utf-8" },
				method: "PATCH",
			},
		);
	} catch (colorError) {
		const calendarUrl = new URL(
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(createdCalendar.id)}`,
		);

		try {
			await fetchGoogleResponseWithRetry(
				authContext,
				googleTokens,
				calendarUrl,
				{ method: "DELETE" },
			);
		} catch (rollbackError) {
			throw new AggregateError(
				[colorError, rollbackError],
				"Google Calendar creation failed and its rollback also failed.",
			);
		}

		throw colorError;
	}

	return { id: createdCalendar.id };
};
