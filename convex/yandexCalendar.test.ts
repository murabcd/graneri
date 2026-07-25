import { describe, expect, it, vi } from "vitest";
import {
	createYandexCalendar,
	createYandexCalendarEvent,
	deleteYandexCalendarEvent,
	listYandexUpcomingEvents,
	updateYandexCalendarEvent,
} from "./yandexCalendar";

const connection = {
	email: "owner@example.com",
	password: "app-password",
	serverAddress: "caldav.yandex.test",
	calendarHomePath: "/calendars/owner%40example.com/",
};

const calendarsResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
	<d:response>
		<d:href>/calendars/owner%40example.com/</d:href>
		<d:propstat>
			<d:prop>
				<d:displayname>Calendars</d:displayname>
				<d:resourcetype><d:collection /></d:resourcetype>
			</d:prop>
		</d:propstat>
	</d:response>
	<d:response>
		<d:href>/calendars/owner%40example.com/events-1/</d:href>
		<d:propstat>
			<d:prop>
				<d:displayname>Personal</d:displayname>
				<a:calendar-color>#10B981FF</a:calendar-color>
				<d:resourcetype><d:collection /><c:calendar /></d:resourcetype>
				<c:supported-calendar-component-set>
					<c:comp name="VEVENT" />
				</c:supported-calendar-component-set>
			</d:prop>
		</d:propstat>
	</d:response>
	<d:response>
		<d:href>/calendars/owner%40example.com/todos-1/</d:href>
		<d:propstat>
			<d:prop>
				<d:displayname>Reminders</d:displayname>
				<d:resourcetype><d:collection /><c:calendar /></d:resourcetype>
				<c:supported-calendar-component-set>
					<c:comp name="VTODO" />
				</c:supported-calendar-component-set>
			</d:prop>
		</d:propstat>
	</d:response>
</d:multistatus>`;

const emptyReportResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" />`;

const recurringReportResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
	<d:response>
		<d:href>/calendars/owner%40example.com/events-1/weekly.ics</d:href>
		<d:propstat>
			<d:prop>
				<c:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:weekly-planning
DTSTART:20260727T100000Z
DTEND:20260727T110000Z
RRULE:FREQ=WEEKLY;COUNT=2
SUMMARY:Weekly planning
END:VEVENT
END:VCALENDAR</c:calendar-data>
			</d:prop>
		</d:propstat>
	</d:response>
</d:multistatus>`;

const recurringCalendarResource = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:weekly-planning\r
DTSTART:20260727T100000Z\r
DTEND:20260727T110000Z\r
RRULE:FREQ=WEEKLY;COUNT=2\r
SUMMARY:Weekly planning\r
ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:guest@example.com\r
END:VEVENT\r
END:VCALENDAR\r
`;

describe("Yandex Calendar collections", () => {
	it("creates an event-only calendar with its name and color", async () => {
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, _init?: RequestInit) =>
				new Response("", { status: 201 }),
		);

		await expect(
			createYandexCalendar({
				color: "#3b82f6",
				connection,
				name: "Roadmap & launches",
				request: fetchMock,
				uid: "calendar-123",
			}),
		).resolves.toEqual({
			id: "yandex:/calendars/owner%40example.com/graneri-calendar-123/",
		});

		const [calendarUrl, calendarInit] = fetchMock.mock.calls[0] ?? [];
		expect(String(calendarUrl)).toBe(
			"https://caldav.yandex.test/calendars/owner%40example.com/graneri-calendar-123/",
		);
		expect(calendarInit).toMatchObject({
			method: "MKCALENDAR",
			headers: {
				"Content-Type": "application/xml; charset=utf-8",
			},
		});
		expect(calendarInit?.headers).not.toHaveProperty("Depth");
		expect(calendarInit?.body).toContain(
			"<d:displayname>Roadmap &amp; launches</d:displayname>",
		);
		expect(calendarInit?.body).toContain('<c:comp name="VEVENT" />');
		expect(calendarInit?.body).toContain(
			"<a:calendar-color>#3B82F6FF</a:calendar-color>",
		);
	});

	it("loads only collections that support calendar events", async () => {
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				if (init?.method === "PROPFIND") {
					return new Response(calendarsResponse, { status: 207 });
				}

				return new Response(emptyReportResponse, { status: 207 });
			},
		);

		const result = await listYandexUpcomingEvents({
			connection,
			now: 0,
			request: fetchMock,
			timeMin: Date.UTC(2026, 6, 25),
			timeMax: Date.UTC(2026, 7, 24),
		});

		expect(result).toEqual({
			calendars: [
				{
					canCreateEvents: true,
					color: "#10B981",
					id: "yandex:/calendars/owner%40example.com/events-1/",
					name: "Personal",
					provider: "yandex",
				},
			],
			connectedCalendarCount: 1,
			events: [],
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("marks expanded recurrence instances as recurring", async () => {
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) =>
				new Response(
					init?.method === "PROPFIND"
						? calendarsResponse
						: recurringReportResponse,
					{ status: 207 },
				),
		);

		const result = await listYandexUpcomingEvents({
			connection,
			now: 0,
			request: fetchMock,
			timeMin: Date.UTC(2026, 6, 25),
			timeMax: Date.UTC(2026, 7, 24),
		});

		expect(result.events).toHaveLength(2);
		expect(result.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					isRecurring: true,
					title: "Weekly planning",
				}),
			]),
		);
	});

	it("creates an event with a conditional CalDAV PUT", async () => {
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				if (init?.method === "PROPFIND") {
					return new Response(calendarsResponse, { status: 207 });
				}

				return new Response("", { status: 201 });
			},
		);

		await expect(
			createYandexCalendarEvent({
				connection,
				input: {
					calendarId: "yandex:/calendars/owner%40example.com/events-1/",
					description: "Agenda, decisions; follow-up",
					guests: ["guest@example.com"],
					location: "Room 1",
					time: {
						kind: "timed",
						startAt: "2026-07-27T07:00:00.000Z",
						endAt: "2026-07-27T08:00:00.000Z",
					},
					title: "Product sync",
				},
				now: Date.UTC(2026, 6, 25, 10),
				request: fetchMock,
				uid: "event-123",
			}),
		).resolves.toEqual({ id: "yandex:event-123" });

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [putUrl, putInit] = fetchMock.mock.calls[1] ?? [];
		expect(String(putUrl)).toBe(
			"https://caldav.yandex.test/calendars/owner%40example.com/events-1/event-123.ics",
		);
		expect(putInit).toMatchObject({
			method: "PUT",
			headers: {
				"Content-Type": "text/calendar; charset=utf-8",
				"If-None-Match": "*",
			},
		});
		expect(putInit?.body).toContain("BEGIN:VEVENT\r\n");
		expect(putInit?.body).toContain("DTSTART:20260727T070000Z\r\n");
		expect(putInit?.body).toContain("DTEND:20260727T080000Z\r\n");
		expect(putInit?.body).toContain(
			"DESCRIPTION:Agenda\\, decisions\\; follow-up\r\n",
		);
		expect(putInit?.body).toContain(
			"ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:guest@example.com\r\n",
		);
	});

	it("updates one recurring occurrence without replacing the series", async () => {
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				if (init?.method === "PROPFIND") {
					return new Response(calendarsResponse, { status: 207 });
				}

				if (init?.method === "GET") {
					return new Response(recurringCalendarResource, {
						status: 200,
						headers: { etag: '"event-1"' },
					});
				}

				return new Response(null, { status: 204 });
			},
		);

		await expect(
			updateYandexCalendarEvent({
				connection,
				input: {
					calendarId: "yandex:/calendars/owner%40example.com/events-1/",
					location: "Room 2",
					providerEventId: "/calendars/owner%40example.com/events-1/weekly.ics",
					recurrenceId: "2026-07-27T10:00:00.000Z",
					recurrenceIsAllDay: false,
					time: {
						kind: "timed",
						startAt: "2026-07-27T10:30:00.000Z",
						endAt: "2026-07-27T11:30:00.000Z",
					},
					title: "Updated weekly planning",
				},
				now: Date.UTC(2026, 6, 25, 10),
				request: fetchMock,
			}),
		).resolves.toBeNull();

		const [putUrl, putInit] = fetchMock.mock.calls[2] ?? [];
		expect(String(putUrl)).toBe(
			"https://caldav.yandex.test/calendars/owner%40example.com/events-1/weekly.ics",
		);
		expect(putInit).toMatchObject({
			method: "PUT",
			headers: {
				"If-Match": '"event-1"',
			},
		});
		expect(putInit?.body).toContain("RECURRENCE-ID:20260727T100000Z\r\n");
		expect(putInit?.body).toContain("SUMMARY:Updated weekly planning\r\n");
		expect(putInit?.body).toContain(
			"ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:guest@example.com\r\n",
		);
		expect(putInit?.body).toContain("RRULE:FREQ=WEEKLY;COUNT=2\r\n");
	});

	it("cancels only the selected recurring occurrence", async () => {
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				if (init?.method === "PROPFIND") {
					return new Response(calendarsResponse, { status: 207 });
				}

				if (init?.method === "GET") {
					return new Response(recurringCalendarResource, {
						status: 200,
						headers: { etag: '"event-1"' },
					});
				}

				return new Response(null, { status: 204 });
			},
		);

		await expect(
			deleteYandexCalendarEvent({
				calendarId: "yandex:/calendars/owner%40example.com/events-1/",
				connection,
				providerEventId: "/calendars/owner%40example.com/events-1/weekly.ics",
				recurrenceId: "2026-07-27T10:00:00.000Z",
				request: fetchMock,
			}),
		).resolves.toBeNull();

		const [, putInit] = fetchMock.mock.calls[2] ?? [];
		expect(putInit?.body).toContain("RECURRENCE-ID:20260727T100000Z\r\n");
		expect(putInit?.body).toContain("STATUS:CANCELLED\r\n");
		expect(putInit?.body).toContain("RRULE:FREQ=WEEKLY;COUNT=2\r\n");
	});
});
