import { describe, expect, it, vi } from "vitest";
import { runCalendarToolQuery } from "./calendarToolQuery";
import type {
	CalendarEventsFetchResult,
	UpcomingCalendarEvent,
} from "./calendarTypes";

const NOW = Date.parse("2026-08-08T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const createEvent = ({
	attendeeName,
	description,
	htmlLink,
	id,
	meetingUrl,
	startAt,
}: {
	attendeeName?: string;
	description?: string;
	htmlLink?: string;
	id: string;
	meetingUrl?: string;
	startAt: string;
}): UpcomingCalendarEvent => ({
	attendees: attendeeName
		? [
				{
					displayName: attendeeName,
					email: "alexander@zhirnov.studio",
					isOrganizer: false,
					isSelf: false,
					responseStatus: "accepted",
				},
			]
		: [],
	canDelete: true,
	canEdit: true,
	guestPermissions: "manage",
	canMove: true,
	canRemove: false,
	calendarId: "calendar-id",
	calendarName: "Internal",
	...(description ? { description } : {}),
	endAt: new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString(),
	...(htmlLink ? { htmlLink } : {}),
	id,
	isAllDay: false,
	isMeeting: true,
	isRecurring: false,
	...(meetingUrl ? { meetingUrl } : {}),
	provider: "google",
	providerEventId: id,
	startAt,
	title: `Event ${id}`,
});

const createResult = (
	events: UpcomingCalendarEvent[],
): CalendarEventsFetchResult => ({
	calendars: [],
	connectedCalendarCount: 1,
	events,
});

describe("calendar tool query", () => {
	it("searches the complete bounded provider result before applying the output limit", async () => {
		const earlyEvents = Array.from({ length: 30 }, (_, index) =>
			createEvent({
				id: `event-${index}`,
				startAt: new Date(NOW + index * 60_000).toISOString(),
			}),
		);
		const matchingEvent = createEvent({
			attendeeName: "Александр Жирнов",
			id: "alexander-meeting",
			startAt: new Date(NOW + 31 * 60_000).toISOString(),
		});
		const listEvents = vi.fn(async () =>
			createResult([...earlyEvents, matchingEvent]),
		);

		const result = await runCalendarToolQuery({
			adapter: { listEvents },
			connection: "Google Calendar",
			limit: 10,
			now: NOW,
			query: "Александр Жирнов",
		});

		expect(listEvents).toHaveBeenCalledWith({
			eventLimit: 250,
			minimumEndAt: NOW,
			timeMax: NOW + 180 * DAY_MS,
			timeMin: NOW - 30 * DAY_MS,
		});
		expect(result.events.map((event) => event.id)).toEqual([
			"alexander-meeting",
		]);
	});

	it("matches descriptions and builds deduplicated sources with meeting URL fallback", async () => {
		const meetingUrl = "https://meet.example.com/design";
		const listEvents = vi.fn(async () =>
			createResult([
				createEvent({
					description: "Quarterly architecture review",
					id: "later",
					meetingUrl,
					startAt: new Date(NOW + 2 * 60_000).toISOString(),
				}),
				createEvent({
					description: "Architecture follow-up",
					htmlLink: "https://calendar.example.com/event",
					id: "earlier",
					meetingUrl,
					startAt: new Date(NOW + 60_000).toISOString(),
				}),
			]),
		);

		const result = await runCalendarToolQuery({
			adapter: { listEvents },
			connection: "Yandex Calendar",
			now: NOW,
			query: "architecture",
		});

		expect(result.events.map((event) => event.id)).toEqual([
			"earlier",
			"later",
		]);
		expect(result.sources).toEqual([
			{
				title: "Event earlier",
				type: "url",
				url: "https://calendar.example.com/event",
			},
			{
				title: "Event later",
				type: "url",
				url: meetingUrl,
			},
		]);
	});
});
