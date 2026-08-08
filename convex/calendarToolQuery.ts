import type { CalendarProviderAdapter } from "./calendarProviderModule";
import type { UpcomingCalendarEvent } from "./calendarTypes";

const DAY_MS = 24 * 60 * 60 * 1000;
const CALENDAR_TOOL_LOOKBACK_MS = 30 * DAY_MS;
const CALENDAR_TOOL_LOOKAHEAD_MS = 180 * DAY_MS;
const CALENDAR_TOOL_FETCH_LIMIT = 250;
const DEFAULT_CALENDAR_TOOL_RESULT_LIMIT = 10;
const MAX_CALENDAR_TOOL_RESULT_LIMIT = 25;

type CalendarToolQueryAdapter = Pick<CalendarProviderAdapter, "listEvents">;

type CalendarToolQueryInput = {
	adapter: CalendarToolQueryAdapter;
	connection: string;
	limit?: number;
	meetingsOnly?: boolean;
	now: number;
	query?: string;
};

const matchesCalendarSearchQuery = (
	event: UpcomingCalendarEvent,
	normalizedQuery: string,
) =>
	[
		event.title,
		event.calendarName,
		event.description,
		event.location,
		event.meetingUrl,
		...event.attendees.flatMap((attendee) => [
			attendee.displayName,
			attendee.email,
		]),
	]
		.filter((value): value is string => Boolean(value))
		.join(" ")
		.toLowerCase()
		.includes(normalizedQuery);

const buildCalendarToolSources = (events: UpcomingCalendarEvent[]) => {
	const seen = new Set<string>();

	return events.flatMap((event) => {
		const url = event.htmlLink ?? event.meetingUrl;
		if (!url || seen.has(url)) {
			return [];
		}

		seen.add(url);
		return [{ title: event.title, type: "url" as const, url }];
	});
};

export const runCalendarToolQuery = async ({
	adapter,
	connection,
	limit,
	meetingsOnly,
	now,
	query,
}: CalendarToolQueryInput) => {
	const result = await adapter.listEvents({
		eventLimit: CALENDAR_TOOL_FETCH_LIMIT,
		minimumEndAt: now,
		timeMax: now + CALENDAR_TOOL_LOOKAHEAD_MS,
		timeMin: now - CALENDAR_TOOL_LOOKBACK_MS,
	});
	const normalizedQuery = query?.trim().toLowerCase() ?? "";
	const resultLimit = Math.max(
		1,
		Math.min(
			limit ?? DEFAULT_CALENDAR_TOOL_RESULT_LIMIT,
			MAX_CALENDAR_TOOL_RESULT_LIMIT,
		),
	);
	const events = result.events
		.filter((event) => {
			if (meetingsOnly && !event.isMeeting) {
				return false;
			}

			return (
				!normalizedQuery || matchesCalendarSearchQuery(event, normalizedQuery)
			);
		})
		.sort(
			(left, right) =>
				new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
		)
		.slice(0, resultLimit);

	return {
		connection,
		events,
		sources: buildCalendarToolSources(events),
	};
};
