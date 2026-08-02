"use node";

import { ConvexError } from "convex/values";
import { requireCalendarEventEtag } from "./calendarProviderConcurrency";
import type {
	CalendarEventDetailsInput,
	UpdateCalendarEventInput,
} from "./calendarTypes";
import {
	buildYandexCalendarUrl,
	fetchYandexDav,
	listYandexCalendarCollections,
	normalizeHrefPath,
	normalizeYandexCalendarEmail,
	requireSuccessfulDavResponse,
} from "./yandexCalendar";
import {
	cancelYandexCalendarOccurrence,
	declineYandexCalendarOccurrence,
	hasYandexCalendarGuestChanges,
	normalizeYandexAttendeeEmail,
	updateYandexCalendarResource,
	updateYandexCalendarResourceGuests,
} from "./yandexCalendarEventMutation";
import { parseIcsEvents } from "./yandexCalendarIcs";
import { buildYandexCalendarEventIcs } from "./yandexCalendarIcsWriter";
import type { YandexCalendarConnection } from "./yandexCalendarTypes";

const getYandexCalendarEventTarget = async ({
	calendarId,
	connection,
	providerEventId,
	request,
}: {
	calendarId: string;
	connection: YandexCalendarConnection;
	providerEventId: string;
	request?: typeof fetch;
}) => {
	const calendars = await listYandexCalendarCollections({
		connection,
		request,
	});
	const calendar = calendars.find((candidate) => candidate.id === calendarId);

	if (!calendar) {
		throw new Error("The selected Yandex calendar is not available.");
	}

	if (!calendar.canWrite) {
		throw new ConvexError({
			code: "CALENDAR_NOT_WRITABLE",
			message: "The selected calendar does not allow event changes.",
		});
	}

	const calendarPath = `${normalizeHrefPath(calendar.href).replace(/\/?$/u, "/")}`;
	const eventPath = normalizeHrefPath(providerEventId);

	if (!eventPath.startsWith(calendarPath) || eventPath === calendarPath) {
		throw new Error("The selected Yandex event is not in this calendar.");
	}

	return eventPath;
};

const getWritableYandexCalendar = async ({
	calendarId,
	connection,
	request,
}: {
	calendarId: string;
	connection: YandexCalendarConnection;
	request?: typeof fetch;
}) => {
	const calendars = await listYandexCalendarCollections({
		connection,
		request,
	});
	const calendar = calendars.find((candidate) => candidate.id === calendarId);

	if (!calendar) {
		throw new Error("The selected Yandex calendar is not available.");
	}
	if (!calendar.canWrite) {
		throw new ConvexError({
			code: "CALENDAR_NOT_WRITABLE",
			message: "The selected calendar does not allow event changes.",
		});
	}

	return calendar;
};

const loadYandexCalendarEventResource = async ({
	connection,
	path,
	request,
}: {
	connection: YandexCalendarConnection;
	path: string;
	request?: typeof fetch;
}) => {
	const response = await fetchYandexDav({
		connection,
		method: "GET",
		path,
		request,
	});
	const calendarData = await requireSuccessfulDavResponse(
		response,
		"Failed to load Yandex event",
	);

	return {
		calendarData,
		etag: response.headers.get("etag") ?? undefined,
	};
};

const getYandexCalendarEventEditMode = ({
	calendarData,
	connection,
	operation,
}: {
	calendarData: string;
	connection: YandexCalendarConnection;
	operation: "delete" | "edit" | "remove";
}) => {
	const baseEvent = parseIcsEvents(calendarData).find(
		(event) => !event.properties["RECURRENCE-ID"],
	);
	const organizer = baseEvent?.properties.ORGANIZER;

	if (!baseEvent) {
		throw new Error("The Yandex event resource has no editable event.");
	}

	const selfEmail = normalizeYandexCalendarEmail(connection.email);
	const isOrganizer =
		!organizer || normalizeYandexAttendeeEmail(organizer.value) === selfEmail;

	const isAttendee = baseEvent.attendees.some(
		(attendee) => normalizeYandexAttendeeEmail(attendee.value) === selfEmail,
	);
	if (operation === "remove") {
		if (!isOrganizer && isAttendee) {
			return "remove" as const;
		}
		throw new ConvexError({
			code: "CALENDAR_EVENT_REMOVE_FORBIDDEN",
			message: "Only an invited attendee can remove this event.",
		});
	}

	if (isOrganizer) {
		return "full" as const;
	}

	if (operation === "edit" && isAttendee) {
		return "guests" as const;
	}
	throw new ConvexError({
		code:
			operation === "edit"
				? "CALENDAR_EVENT_EDIT_FORBIDDEN"
				: "CALENDAR_EVENT_DELETE_FORBIDDEN",
		message: `Only the organizer can ${operation} this event.`,
	});
};

export const updateYandexCalendarEvent = async ({
	connection,
	input,
	now = Date.now(),
	request,
}: {
	connection: YandexCalendarConnection;
	input: UpdateCalendarEventInput;
	now?: number;
	request?: typeof fetch;
}) => {
	const path = await getYandexCalendarEventTarget({
		calendarId: input.calendarId,
		connection,
		providerEventId: input.providerEventId,
		request,
	});
	const { calendarData, etag } = await loadYandexCalendarEventResource({
		connection,
		path,
		request,
	});
	const editMode = getYandexCalendarEventEditMode({
		calendarData,
		connection,
		operation: "edit",
	});
	const isMoving = input.destinationCalendarId !== input.calendarId;
	const destinationCalendar = isMoving
		? await getWritableYandexCalendar({
				calendarId: input.destinationCalendarId,
				connection,
				request,
			})
		: null;
	if (isMoving && editMode !== "full") {
		throw new ConvexError({
			code: "CALENDAR_EVENT_MOVE_FORBIDDEN",
			message: "Only the organizer can move this event.",
		});
	}
	if (
		editMode === "guests" &&
		!hasYandexCalendarGuestChanges({
			calendarData,
			guests: input.guests,
			recurrenceId: input.recurrenceId,
			selfEmail: connection.email,
		})
	) {
		return null;
	}
	const concurrencyEtag = requireCalendarEventEtag(etag);
	const response = await fetchYandexDav({
		body:
			editMode === "full"
				? updateYandexCalendarResource({ calendarData, input, now })
				: updateYandexCalendarResourceGuests({
						calendarData,
						guests: input.guests,
						now,
						recurrenceId: input.recurrenceId,
						selfEmail: connection.email,
					}),
		connection,
		contentType: "text/calendar; charset=utf-8",
		headers: { "If-Match": concurrencyEtag },
		method: "PUT",
		path,
		request,
	});

	await requireSuccessfulDavResponse(response, "Failed to update Yandex event");
	if (destinationCalendar) {
		const filename = path.split("/").filter(Boolean).at(-1);
		if (!filename) {
			throw new Error("The Yandex event resource path is invalid.");
		}
		const destinationPath = `${normalizeHrefPath(destinationCalendar.href).replace(/\/?$/u, "/")}${filename}`;
		const refreshed = await loadYandexCalendarEventResource({
			connection,
			path,
			request,
		});
		const moveResponse = await fetchYandexDav({
			connection,
			headers: {
				Destination: buildYandexCalendarUrl(
					connection.serverAddress,
					destinationPath,
				).toString(),
				"If-Match": requireCalendarEventEtag(refreshed.etag),
				Overwrite: "F",
			},
			method: "MOVE",
			path,
			request,
		});
		await requireSuccessfulDavResponse(
			moveResponse,
			"Failed to move Yandex event",
		);
	}
	return null;
};

export const removeYandexCalendarEvent = async ({
	calendarId,
	connection,
	providerEventId,
	recurrenceId,
	recurrenceIsAllDay = false,
	request,
}: {
	calendarId: string;
	connection: YandexCalendarConnection;
	providerEventId: string;
	recurrenceId?: string;
	recurrenceIsAllDay?: boolean;
	request?: typeof fetch;
}) => {
	const path = await getYandexCalendarEventTarget({
		calendarId,
		connection,
		providerEventId,
		request,
	});
	const { calendarData, etag } = await loadYandexCalendarEventResource({
		connection,
		path,
		request,
	});
	getYandexCalendarEventEditMode({
		calendarData,
		connection,
		operation: "remove",
	});
	const concurrencyEtag = requireCalendarEventEtag(etag);

	if (recurrenceId) {
		const response = await fetchYandexDav({
			body: declineYandexCalendarOccurrence({
				calendarData,
				recurrenceId,
				recurrenceIsAllDay,
			}),
			connection,
			contentType: "text/calendar; charset=utf-8",
			headers: {
				"If-Match": concurrencyEtag,
				"Schedule-Reply": "T",
			},
			method: "PUT",
			path,
			request,
		});
		await requireSuccessfulDavResponse(
			response,
			"Failed to decline Yandex event occurrence",
		);
		return null;
	}

	const response = await fetchYandexDav({
		connection,
		headers: {
			"If-Match": concurrencyEtag,
			"Schedule-Reply": "T",
		},
		method: "DELETE",
		path,
		request,
	});
	await requireSuccessfulDavResponse(
		response,
		"Failed to decline Yandex event",
	);
	return null;
};

export const deleteYandexCalendarEvent = async ({
	calendarId,
	connection,
	providerEventId,
	recurrenceId,
	recurrenceIsAllDay = false,
	now = Date.now(),
	request,
}: {
	calendarId: string;
	connection: YandexCalendarConnection;
	providerEventId: string;
	recurrenceId?: string;
	recurrenceIsAllDay?: boolean;
	now?: number;
	request?: typeof fetch;
}) => {
	const path = await getYandexCalendarEventTarget({
		calendarId,
		connection,
		providerEventId,
		request,
	});

	const { calendarData, etag } = await loadYandexCalendarEventResource({
		connection,
		path,
		request,
	});
	getYandexCalendarEventEditMode({
		calendarData,
		connection,
		operation: "delete",
	});
	const concurrencyEtag = requireCalendarEventEtag(etag);

	if (!recurrenceId) {
		const response = await fetchYandexDav({
			connection,
			headers: { "If-Match": concurrencyEtag },
			method: "DELETE",
			path,
			request,
		});
		await requireSuccessfulDavResponse(
			response,
			"Failed to delete Yandex event",
		);
		return null;
	}

	const response = await fetchYandexDav({
		body: cancelYandexCalendarOccurrence({
			calendarData,
			now,
			recurrenceId,
			recurrenceIsAllDay,
		}),
		connection,
		contentType: "text/calendar; charset=utf-8",
		headers: { "If-Match": concurrencyEtag },
		method: "PUT",
		path,
		request,
	});
	await requireSuccessfulDavResponse(
		response,
		"Failed to delete Yandex event occurrence",
	);
	return null;
};

export const createYandexCalendarEvent = async ({
	connection,
	input,
	now = Date.now(),
	request,
	uid = crypto.randomUUID(),
}: {
	connection: YandexCalendarConnection;
	input: CalendarEventDetailsInput;
	now?: number;
	request?: typeof fetch;
	uid?: string;
}) => {
	const calendars = await listYandexCalendarCollections({
		connection,
		request,
	});
	const calendar = calendars.find(
		(candidate) => candidate.id === input.calendarId && candidate.canWrite,
	);

	if (!calendar) {
		throw new Error("The selected Yandex calendar is not available.");
	}

	const eventPath = `${calendar.href.replace(/\/?$/u, "/")}${encodeURIComponent(uid)}.ics`;
	const response = await fetchYandexDav({
		body: buildYandexCalendarEventIcs({ input, now, uid }),
		connection,
		contentType: "text/calendar; charset=utf-8",
		headers: { "If-None-Match": "*" },
		method: "PUT",
		path: eventPath,
		request,
	});

	if (!response.ok) {
		await requireSuccessfulDavResponse(
			response,
			"Failed to create Yandex event",
		);
	}

	return { id: `yandex:${uid}` };
};
