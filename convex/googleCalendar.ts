"use node";

import { ConvexError } from "convex/values";
import {
	createCalendarAttendee,
	normalizeCalendarAttendees,
} from "./calendarAttendees";
import { requireCalendarEventEtag } from "./calendarProviderConcurrency";
import {
	formatCalendarRecurrenceRule,
	getCalendarWeekdayFromDateValue,
	parseCalendarRecurrence,
} from "./calendarRecurrence";
import type {
	CalendarAttendee,
	CalendarEventDetailsInput,
	CalendarEventsFetchResult,
	CalendarRecurrence,
	CalendarSource,
	UpcomingCalendarEvent,
	UpdateCalendarEventInput,
} from "./calendarTypes";
import {
	fetchGoogleJsonWithRetry,
	fetchGoogleResponseWithRetry,
	GOOGLE_CALENDAR_LIST_MANAGE_SCOPE,
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
	primary?: boolean;
	selected?: boolean;
	summary?: string;
	summaryOverride?: string;
};

type GoogleCalendarEventsResponse = {
	items?: GoogleCalendarEvent[];
};

type GoogleCalendarEvent = {
	attendees?: Array<{
		displayName?: string;
		email?: string;
		organizer?: boolean;
		responseStatus?: string;
		self?: boolean;
	}>;
	etag?: string;
	conferenceData?: {
		entryPoints?: Array<{
			entryPointType?: string;
			uri?: string;
		}>;
	};
	creator?: {
		self?: boolean;
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
	organizer?: {
		displayName?: string;
		email?: string;
		self?: boolean;
	};
	guestsCanInviteOthers?: boolean;
	guestsCanModify?: boolean;
	recurrence?: string[];
	recurringEventId?: string;
	start?: GoogleCalendarDateTime;
	status?: string;
	summary?: string;
};

type GoogleCalendarDateTime = {
	date?: string;
	dateTime?: string;
	timeZone?: string;
};

const isVisibleCalendar = (calendar: GoogleCalendarListEntry) =>
	Boolean(calendar.id) &&
	calendar.hidden !== true &&
	calendar.selected !== false &&
	calendar.accessRole !== "freeBusyReader";

const canCreateEvents = (calendar: GoogleCalendarListEntry) =>
	calendar.accessRole === "owner" || calendar.accessRole === "writer";

const canManageAllCalendarEvents = (calendar: GoogleCalendarListEntry) =>
	calendar.accessRole === "writer" ||
	(calendar.accessRole === "owner" && calendar.primary !== true);

const getGoogleEventCapabilities = (
	calendar: GoogleCalendarListEntry,
	event: GoogleCalendarEvent,
) => {
	const hasDelegatedCalendarWrite = canManageAllCalendarEvents(calendar);
	const isOrganizerOrCreator =
		event.organizer?.self === true || event.creator?.self === true;
	const isSelfAttendee =
		event.attendees?.some((attendee) => attendee.self === true) ?? false;
	const canEdit =
		hasDelegatedCalendarWrite ||
		isOrganizerOrCreator ||
		event.guestsCanModify === true;
	const isDefaultEvent = !event.eventType || event.eventType === "default";
	const isWithinMoveAttendeeLimit = (event.attendees?.length ?? 0) <= 200;

	return {
		canDelete: hasDelegatedCalendarWrite || isOrganizerOrCreator,
		canEdit,
		guestPermissions: canEdit
			? ("manage" as const)
			: isSelfAttendee && event.guestsCanInviteOthers !== false
				? ("invite" as const)
				: ("none" as const),
		canMove:
			isDefaultEvent &&
			isWithinMoveAttendeeLimit &&
			(hasDelegatedCalendarWrite || isOrganizerOrCreator),
		canRemove: isSelfAttendee && !isOrganizerOrCreator,
	};
};

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
	attendees: CalendarAttendee[];
	meetingUrl?: string;
}) =>
	Boolean(meetingUrl) ||
	(attendees?.some(
		(attendee) =>
			attendee.isSelf !== true && attendee.responseStatus !== "declined",
	) ??
		false);

const normalizeGoogleAttendees = (event: GoogleCalendarEvent) => {
	const attendees = (event.attendees ?? []).flatMap((attendee) => {
		if (!attendee.email) {
			return [];
		}

		const normalized = createCalendarAttendee({
			displayName: attendee.displayName,
			email: attendee.email,
			isOrganizer: attendee.organizer,
			isSelf: attendee.self,
			responseStatus: attendee.responseStatus,
		});

		return normalized ? [normalized] : [];
	});

	if (event.organizer?.email) {
		const organizer = createCalendarAttendee({
			displayName: event.organizer.displayName,
			email: event.organizer.email,
			isOrganizer: true,
			isSelf: event.organizer.self,
			responseStatus: "accepted",
		});

		if (organizer) {
			attendees.push(organizer);
		}
	}

	return normalizeCalendarAttendees(attendees);
};

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
	canWrite: boolean,
	recurrence?: CalendarRecurrence,
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
	const attendees = normalizeGoogleAttendees(event);
	const capabilities = getGoogleEventCapabilities(calendar, event);

	return {
		attendees,
		canDelete: canWrite && capabilities.canDelete,
		canEdit: canWrite && capabilities.canEdit,
		guestPermissions: canWrite ? capabilities.guestPermissions : "none",
		canMove: canWrite && capabilities.canMove,
		canRemove: canWrite && capabilities.canRemove,
		calendarId: calendar.id,
		calendarName: calendar.summary || "Calendar",
		description: event.description?.trim() || undefined,
		endAt: endAt.toISOString(),
		htmlLink: event.htmlLink,
		id: event.iCalUID ?? event.id,
		isAllDay: Boolean(event.start?.date && !event.start?.dateTime),
		isMeeting: isMeetingEvent({
			attendees,
			meetingUrl,
		}),
		isRecurring: Boolean(
			event.recurringEventId || (event.recurrence?.length ?? 0) > 0,
		),
		location: event.location?.trim() || undefined,
		meetingUrl,
		provider: "google",
		providerEventId: event.id,
		recurrence:
			recurrence ??
			parseCalendarRecurrence({
				defaultWeekday: getCalendarWeekdayFromDateValue(
					event.start?.dateTime ?? event.start?.date,
				),
				recurrenceLines: event.recurrence ?? [],
				timeZone: event.start?.timeZone,
			}),
		recurrenceId: event.originalStartTime
			? (toDate(event.originalStartTime, false)?.toISOString() ?? undefined)
			: undefined,
		seriesProviderEventId: event.recurringEventId,
		startAt: startAt.toISOString(),
		title: event.summary?.trim() || "Untitled event",
	};
};

const GOOGLE_RECURRENCE_FETCH_BATCH_SIZE = 8;

const getGoogleEventRecurrence = (event: GoogleCalendarEvent) =>
	parseCalendarRecurrence({
		defaultWeekday: getCalendarWeekdayFromDateValue(
			event.start?.dateTime ?? event.start?.date,
		),
		recurrenceLines: event.recurrence ?? [],
		timeZone: event.start?.timeZone,
	});

const fetchGoogleSeriesRecurrences = async ({
	authContext,
	calendarId,
	events,
	googleTokens,
}: {
	authContext: GoogleAuthContext;
	calendarId: string;
	events: GoogleCalendarEvent[];
	googleTokens: NonNullable<Awaited<ReturnType<typeof getGoogleAccessToken>>>;
}) => {
	const seriesIds = [
		...new Set(
			events.flatMap((event) =>
				event.recurringEventId ? [event.recurringEventId] : [],
			),
		),
	];
	const recurrences = new Map<string, CalendarRecurrence>();

	for (
		let offset = 0;
		offset < seriesIds.length;
		offset += GOOGLE_RECURRENCE_FETCH_BATCH_SIZE
	) {
		const batch = seriesIds.slice(
			offset,
			offset + GOOGLE_RECURRENCE_FETCH_BATCH_SIZE,
		);
		const results = await Promise.allSettled(
			batch.map(async (seriesId) => {
				const eventUrl = new URL(
					`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(seriesId)}`,
				);
				const seriesEvent = await fetchGoogleJsonWithRetry<GoogleCalendarEvent>(
					authContext,
					googleTokens,
					eventUrl,
				);

				return {
					recurrence: getGoogleEventRecurrence(seriesEvent),
					seriesId,
				};
			}),
		);

		for (const result of results) {
			if (result.status === "fulfilled" && result.value.recurrence) {
				recurrences.set(result.value.seriesId, result.value.recurrence);
			}
		}
	}

	return recurrences;
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
	const calendars = providerCalendars.map((calendar) => {
		const canManageCalendarList = googleTokens.scopes.includes(
			GOOGLE_CALENDAR_LIST_MANAGE_SCOPE,
		);
		const canManageCalendarMetadata = googleTokens.scopes.includes(
			GOOGLE_CALENDAR_MANAGE_SCOPE,
		);
		const canManageCalendarEvents = googleTokens.scopes.includes(
			GOOGLE_CALENDAR_WRITE_SCOPE,
		);
		const isOwnedCalendar = calendar.accessRole === "owner";
		const canDeleteOwnedCalendar =
			isOwnedCalendar &&
			canManageCalendarList &&
			canManageCalendarMetadata &&
			canManageCalendarEvents;
		const removalMode =
			calendar.primary === true
				? ("none" as const)
				: canDeleteOwnedCalendar
					? ("delete" as const)
					: !isOwnedCalendar && canManageCalendarList
						? ("unsubscribe" as const)
						: ("none" as const);

		return {
			canCreateEvents:
				googleTokens.scopes.includes(GOOGLE_CALENDAR_WRITE_SCOPE) &&
				canCreateEvents(calendar),
			canEdit:
				canManageCalendarList &&
				(!isOwnedCalendar || canManageCalendarMetadata),
			canSetDefault: false,
			color: requireCalendarColor(calendar),
			id: calendar.id,
			name: calendar.summaryOverride || calendar.summary || "Calendar",
			provider: "google",
			removalMode,
			requiresEventMove: removalMode === "delete",
		} satisfies CalendarSource;
	});
	const hasWriteScope = googleTokens.scopes.includes(
		GOOGLE_CALENDAR_WRITE_SCOPE,
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
			const providerEvents = response.items ?? [];
			const recurrences = await fetchGoogleSeriesRecurrences({
				authContext,
				calendarId: calendar.id,
				events: providerEvents,
				googleTokens,
			});

			return providerEvents
				.map((event) =>
					normalizeEvent(
						calendar,
						event,
						minimumEndAt,
						hasWriteScope,
						event.recurringEventId
							? recurrences.get(event.recurringEventId)
							: undefined,
					),
				)
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
					recurrence: input.recurrence
						? [
								formatCalendarRecurrenceRule({
									isAllDay: true,
									recurrence: input.recurrence,
								}),
							]
						: undefined,
					start: { date: input.time.startDate },
					summary: input.title,
				}
			: {
					attendees: input.guests.map((email) => ({ email })),
					description: input.description,
					end: {
						dateTime: input.time.endAt,
						timeZone: input.recurrence?.timeZone,
					},
					location: input.location,
					recurrence: input.recurrence
						? [
								formatCalendarRecurrenceRule({
									isAllDay: false,
									recurrence: input.recurrence,
								}),
							]
						: undefined,
					start: {
						dateTime: input.time.startAt,
						timeZone: input.recurrence?.timeZone,
					},
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

const normalizeGoogleCalendarEmail = (value: string) =>
	value.trim().toLowerCase();

const getUpdatedGoogleAttendees = (
	input: UpdateCalendarEventInput,
	event: GoogleCalendarEvent,
	options: { preserveExistingGuests?: boolean } = {},
) => {
	const organizerEmail = event.organizer?.email
		? normalizeGoogleCalendarEmail(event.organizer.email)
		: null;
	const existingAttendees = new Map(
		(event.attendees ?? []).flatMap((attendee) => {
			if (!attendee.email || attendee.organizer) {
				return [];
			}

			return [
				[normalizeGoogleCalendarEmail(attendee.email), attendee] as const,
			];
		}),
	);
	const requestedEmails = options.preserveExistingGuests
		? [...existingAttendees.keys(), ...input.guests]
		: input.guests;

	return [
		...new Set(
			requestedEmails
				.map(normalizeGoogleCalendarEmail)
				.filter((email) => email !== organizerEmail),
		),
	].map((email) => {
		const existing = existingAttendees.get(normalizeGoogleCalendarEmail(email));

		return {
			email,
			...(existing?.responseStatus && {
				responseStatus: existing.responseStatus,
			}),
		};
	});
};

const hasNewGoogleGuests = (
	input: UpdateCalendarEventInput,
	event: GoogleCalendarEvent,
) => {
	const existingEmails = new Set(
		[
			event.organizer?.email,
			...(event.attendees ?? []).map((attendee) => attendee.email),
		]
			.filter((email): email is string => Boolean(email))
			.map(normalizeGoogleCalendarEmail),
	);

	return input.guests.some(
		(email) => !existingEmails.has(normalizeGoogleCalendarEmail(email)),
	);
};

const getEventBody = (
	input: UpdateCalendarEventInput,
	event: GoogleCalendarEvent,
) =>
	input.time.kind === "all_day"
		? {
				attendees: getUpdatedGoogleAttendees(input, event),
				description: input.description ?? "",
				end: { date: input.time.endDate },
				location: input.location ?? "",
				start: { date: input.time.startDate },
				summary: input.title,
			}
		: {
				attendees: getUpdatedGoogleAttendees(input, event),
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
	const event = await fetchGoogleJsonWithRetry<GoogleCalendarEvent>(
		authContext,
		googleTokens,
		eventUrl,
	);

	const capabilities = getGoogleEventCapabilities(calendar, event);
	if (!capabilities.canEdit && capabilities.guestPermissions === "none") {
		throw new ConvexError({
			code: "CALENDAR_EVENT_EDIT_FORBIDDEN",
			message: "You do not have permission to edit this event.",
		});
	}
	const isMoving = input.destinationCalendarId !== input.calendarId;
	if (isMoving && !capabilities.canMove) {
		throw new ConvexError({
			code: "CALENDAR_EVENT_MOVE_FORBIDDEN",
			message: "You do not have permission to move this event.",
		});
	}
	if (!capabilities.canEdit && !hasNewGoogleGuests(input, event)) {
		return null;
	}
	if (isMoving) {
		await getWritableCalendar({
			authContext,
			calendarId: input.destinationCalendarId,
		});
	}

	const concurrencyEtag = requireCalendarEventEtag(event.etag);
	eventUrl.searchParams.set("sendUpdates", "all");
	const updatedEvent = await fetchGoogleJsonWithRetry<GoogleCalendarEvent>(
		authContext,
		googleTokens,
		eventUrl,
		{
			body: JSON.stringify(
				capabilities.canEdit
					? getEventBody(input, event)
					: {
							attendees: getUpdatedGoogleAttendees(input, event, {
								preserveExistingGuests: true,
							}),
						},
			),
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"If-Match": concurrencyEtag,
			},
			method: "PATCH",
		},
	);

	if (isMoving) {
		const moveEventId = input.seriesProviderEventId ?? input.providerEventId;
		let moveEtag = updatedEvent.etag;
		if (moveEventId !== input.providerEventId) {
			const seriesUrl = new URL(
				`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(moveEventId)}`,
			);
			const seriesEvent = await fetchGoogleJsonWithRetry<GoogleCalendarEvent>(
				authContext,
				googleTokens,
				seriesUrl,
			);
			if (!getGoogleEventCapabilities(calendar, seriesEvent).canMove) {
				throw new ConvexError({
					code: "CALENDAR_EVENT_MOVE_FORBIDDEN",
					message: "You do not have permission to move this event series.",
				});
			}
			moveEtag = seriesEvent.etag;
		}
		const moveUrl = new URL(
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(moveEventId)}/move`,
		);
		moveUrl.searchParams.set("destination", input.destinationCalendarId);
		moveUrl.searchParams.set("sendUpdates", "all");
		await fetchGoogleJsonWithRetry<GoogleCalendarEvent>(
			authContext,
			googleTokens,
			moveUrl,
			{
				headers: { "If-Match": requireCalendarEventEtag(moveEtag) },
				method: "POST",
			},
		);
	}
	return null;
};

export const removeGoogleCalendarEvent = async ({
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
	const event = await fetchGoogleJsonWithRetry<GoogleCalendarEvent>(
		authContext,
		googleTokens,
		eventUrl,
	);

	if (!getGoogleEventCapabilities(calendar, event).canRemove) {
		throw new ConvexError({
			code: "CALENDAR_EVENT_REMOVE_FORBIDDEN",
			message: "You do not have permission to remove this invitation.",
		});
	}

	eventUrl.searchParams.set("sendUpdates", "all");
	await fetchGoogleResponseWithRetry(authContext, googleTokens, eventUrl, {
		headers: { "If-Match": requireCalendarEventEtag(event.etag) },
		method: "DELETE",
	});
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
	const event = await fetchGoogleJsonWithRetry<GoogleCalendarEvent>(
		authContext,
		googleTokens,
		eventUrl,
	);

	if (!getGoogleEventCapabilities(calendar, event).canDelete) {
		throw new ConvexError({
			code: "CALENDAR_EVENT_DELETE_FORBIDDEN",
			message: "You do not have permission to delete this event.",
		});
	}

	const concurrencyEtag = requireCalendarEventEtag(event.etag);
	eventUrl.searchParams.set("sendUpdates", "all");
	await fetchGoogleResponseWithRetry(authContext, googleTokens, eventUrl, {
		headers: { "If-Match": concurrencyEtag },
		method: "DELETE",
	});
	return null;
};

export {
	createGoogleCalendar,
	removeGoogleCalendar,
	updateGoogleCalendar,
} from "./googleCalendarManagement";
