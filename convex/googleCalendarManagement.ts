"use node";

import { ConvexError } from "convex/values";
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
import type {
	GoogleCalendarListEntry,
	GoogleCalendarListResponse,
} from "./googleCalendarApiTypes";

type GoogleCalendarEventListItem = {
	eventType?: string;
	id: string;
};

const requireGoogleCalendarManagement = async ({
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
		!googleTokens.scopes.includes(GOOGLE_CALENDAR_LIST_MANAGE_SCOPE)
	) {
		throw new ConvexError({
			code: "GOOGLE_CALENDAR_MANAGE_NOT_CONNECTED",
			message: "Reconnect Google Calendar to manage calendars.",
		});
	}

	const calendarListEntryUrl = new URL(
		`https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(calendarId)}`,
	);
	calendarListEntryUrl.searchParams.set("colorRgbFormat", "true");
	const calendar = await fetchGoogleJsonWithRetry<GoogleCalendarListEntry>(
		authContext,
		googleTokens,
		calendarListEntryUrl,
	);

	if (!calendar.id || calendar.id !== calendarId) {
		throw new Error("Google Calendar did not return the selected calendar.");
	}

	return { calendar, calendarListEntryUrl, googleTokens };
};

const requireWritableGoogleCalendar = async ({
	authContext,
	calendarId,
	googleTokens,
}: {
	authContext: GoogleAuthContext;
	calendarId: string;
	googleTokens: Awaited<ReturnType<typeof getGoogleAccessToken>> & {
		accessToken: string;
	};
}) => {
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
	const calendar = calendarList.items?.find(
		(candidate) => candidate.id === calendarId,
	);
	if (calendar?.accessRole !== "owner" && calendar?.accessRole !== "writer") {
		throw new ConvexError({
			code: "CALENDAR_NOT_WRITABLE",
			message: "The selected calendar does not allow event changes.",
		});
	}
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
		!googleTokens.scopes.includes(GOOGLE_CALENDAR_MANAGE_SCOPE) ||
		!googleTokens.scopes.includes(GOOGLE_CALENDAR_LIST_MANAGE_SCOPE)
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
		await fetchGoogleJsonWithRetry<unknown>(
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

export const updateGoogleCalendar = async ({
	authContext,
	calendarId,
	color,
	name,
}: {
	authContext: GoogleAuthContext;
	calendarId: string;
	color: string;
	name: string;
}) => {
	const { calendar, calendarListEntryUrl, googleTokens } =
		await requireGoogleCalendarManagement({ authContext, calendarId });

	if (calendar.accessRole === "owner") {
		if (!googleTokens.scopes.includes(GOOGLE_CALENDAR_MANAGE_SCOPE)) {
			throw new ConvexError({
				code: "GOOGLE_CALENDAR_MANAGE_NOT_CONNECTED",
				message: "Reconnect Google Calendar to rename owned calendars.",
			});
		}

		const calendarUrl = new URL(
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
		);
		await fetchGoogleJsonWithRetry<unknown>(
			authContext,
			googleTokens,
			calendarUrl,
			{
				body: JSON.stringify({ summary: name }),
				headers: { "Content-Type": "application/json; charset=utf-8" },
				method: "PATCH",
			},
		);
	}

	try {
		await fetchGoogleJsonWithRetry<unknown>(
			authContext,
			googleTokens,
			calendarListEntryUrl,
			{
				body: JSON.stringify({
					backgroundColor: color,
					foregroundColor: "#ffffff",
					...(calendar.accessRole !== "owner" && {
						summaryOverride: name,
					}),
				}),
				headers: { "Content-Type": "application/json; charset=utf-8" },
				method: "PATCH",
			},
		);
	} catch (calendarListError) {
		if (calendar.accessRole !== "owner" || !calendar.summary) {
			throw calendarListError;
		}

		const calendarUrl = new URL(
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
		);
		try {
			await fetchGoogleJsonWithRetry<unknown>(
				authContext,
				googleTokens,
				calendarUrl,
				{
					body: JSON.stringify({ summary: calendar.summary }),
					headers: { "Content-Type": "application/json; charset=utf-8" },
					method: "PATCH",
				},
			);
		} catch (rollbackError) {
			throw new AggregateError(
				[calendarListError, rollbackError],
				"Google Calendar update failed and its rollback also failed.",
			);
		}
		throw calendarListError;
	}
	return null;
};

const listGoogleCalendarEventIds = async ({
	authContext,
	calendarId,
	googleTokens,
}: {
	authContext: GoogleAuthContext;
	calendarId: string;
	googleTokens: Awaited<ReturnType<typeof getGoogleAccessToken>> & {
		accessToken: string;
	};
}) => {
	const eventIds: string[] = [];
	let pageToken: string | undefined;

	do {
		const eventsUrl = new URL(
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
		);
		eventsUrl.searchParams.set("maxResults", "2500");
		eventsUrl.searchParams.set("showDeleted", "false");
		eventsUrl.searchParams.set("singleEvents", "false");
		if (pageToken) {
			eventsUrl.searchParams.set("pageToken", pageToken);
		}
		const page = await fetchGoogleJsonWithRetry<{
			items?: GoogleCalendarEventListItem[];
			nextPageToken?: string;
		}>(authContext, googleTokens, eventsUrl);

		for (const event of page.items ?? []) {
			if (event.eventType && event.eventType !== "default") {
				throw new ConvexError({
					code: "CALENDAR_CONTAINS_UNMOVABLE_EVENTS",
					message:
						"This calendar contains Google event types that cannot be moved.",
				});
			}
			eventIds.push(event.id);
		}
		pageToken = page.nextPageToken;
	} while (pageToken);

	return eventIds;
};

export const removeGoogleCalendar = async ({
	authContext,
	calendarId,
	destinationCalendarId,
}: {
	authContext: GoogleAuthContext;
	calendarId: string;
	destinationCalendarId?: string;
}) => {
	const { calendar, calendarListEntryUrl, googleTokens } =
		await requireGoogleCalendarManagement({ authContext, calendarId });

	if (calendar.primary === true) {
		throw new ConvexError({
			code: "PRIMARY_CALENDAR_CANNOT_BE_DELETED",
			message: "The primary Google calendar cannot be deleted.",
		});
	}

	if (calendar.accessRole !== "owner") {
		await fetchGoogleResponseWithRetry(
			authContext,
			googleTokens,
			calendarListEntryUrl,
			{ method: "DELETE" },
		);
		return null;
	}

	if (
		!googleTokens.scopes.includes(GOOGLE_CALENDAR_MANAGE_SCOPE) ||
		!googleTokens.scopes.includes(GOOGLE_CALENDAR_WRITE_SCOPE)
	) {
		throw new ConvexError({
			code: "GOOGLE_CALENDAR_MANAGE_NOT_CONNECTED",
			message: "Reconnect Google Calendar to delete owned calendars.",
		});
	}
	if (!destinationCalendarId || destinationCalendarId === calendarId) {
		throw new ConvexError({
			code: "CALENDAR_MOVE_DESTINATION_REQUIRED",
			message: "Choose another calendar for the existing events.",
		});
	}

	await requireWritableGoogleCalendar({
		authContext,
		calendarId: destinationCalendarId,
		googleTokens,
	});
	const eventIds = await listGoogleCalendarEventIds({
		authContext,
		calendarId,
		googleTokens,
	});
	for (const eventId of eventIds) {
		const moveUrl = new URL(
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/move`,
		);
		moveUrl.searchParams.set("destination", destinationCalendarId);
		moveUrl.searchParams.set("sendUpdates", "all");
		await fetchGoogleJsonWithRetry<unknown>(
			authContext,
			googleTokens,
			moveUrl,
			{ method: "POST" },
		);
	}

	const calendarUrl = new URL(
		`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
	);
	await fetchGoogleResponseWithRetry(authContext, googleTokens, calendarUrl, {
		method: "DELETE",
	});
	return null;
};
