import { describe, expect, it, vi } from "vitest";
import { listYandexUpcomingEvents } from "./yandexCalendar";
import {
	calendarsResponse,
	calendarsWithDestinationResponse,
	connection,
	getCalendarMetadataResponse,
	recurringCalendarResource,
	recurringReportResponse,
} from "./yandexCalendar.fixtures";
import {
	createYandexCalendarEvent,
	deleteYandexCalendarEvent,
	removeYandexCalendarEvent,
	updateYandexCalendarEvent,
} from "./yandexCalendarEvents";
import { parseYandexCalendarData } from "./yandexCalendarIcs";

describe("Yandex Calendar events", () => {
	it("expands monthly and yearly events created with simple RRULEs", () => {
		const events = parseYandexCalendarData({
			calendar: {
				canEdit: true,
				canWrite: true,
				color: "#3b82f6",
				displayName: "Work",
				href: "/calendars/owner/events/",
				id: "yandex:/calendars/owner/events/",
			},
			calendarData: [
				"BEGIN:VCALENDAR",
				"BEGIN:VEVENT",
				"UID:monthly-planning",
				"DTSTART;TZID=Europe/Moscow:20260731T100000",
				"DTEND;TZID=Europe/Moscow:20260731T110000",
				"RRULE:FREQ=MONTHLY;INTERVAL=1;COUNT=2",
				"SUMMARY:Monthly planning",
				"END:VEVENT",
				"BEGIN:VEVENT",
				"UID:yearly-planning",
				"DTSTART;TZID=Europe/Moscow:20240229T100000",
				"DTEND;TZID=Europe/Moscow:20240229T110000",
				"RRULE:FREQ=YEARLY;INTERVAL=1;COUNT=2",
				"SUMMARY:Yearly planning",
				"END:VEVENT",
				"END:VCALENDAR",
			].join("\r\n"),
			href: "/calendars/owner/events/recurring.ics",
			minimumEndAt: 0,
			selfEmail: "owner@example.com",
			timeMax: Date.UTC(2028, 11, 31),
			timeMin: Date.UTC(2026, 6, 1),
		});

		expect(events.map(({ startAt, title }) => ({ startAt, title }))).toEqual([
			{
				startAt: "2026-07-31T07:00:00.000Z",
				title: "Monthly planning",
			},
			{
				startAt: "2026-08-31T07:00:00.000Z",
				title: "Monthly planning",
			},
			{
				startAt: "2028-02-29T07:00:00.000Z",
				title: "Yearly planning",
			},
		]);
	});

	it("does not fabricate occurrences for unsupported periodic RRULEs", () => {
		const events = parseYandexCalendarData({
			calendar: {
				canEdit: true,
				canWrite: true,
				color: "#3b82f6",
				displayName: "Work",
				href: "/calendars/owner/events/",
				id: "yandex:/calendars/owner/events/",
			},
			calendarData: [
				"BEGIN:VCALENDAR",
				"BEGIN:VEVENT",
				"UID:last-weekday",
				"DTSTART;TZID=Europe/Moscow:20260731T100000",
				"DTEND;TZID=Europe/Moscow:20260731T110000",
				"RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
				"SUMMARY:Last weekday",
				"END:VEVENT",
				"END:VCALENDAR",
			].join("\r\n"),
			href: "/calendars/owner/events/recurring.ics",
			minimumEndAt: 0,
			selfEmail: "owner@example.com",
			timeMax: Date.UTC(2026, 11, 31),
			timeMin: Date.UTC(2026, 6, 1),
		});

		expect(events).toEqual([]);
	});

	it("marks expanded recurrence instances as recurring", async () => {
		const fetchMock = vi.fn(
			async (input: string | URL | Request, init?: RequestInit) => {
				const metadataResponse = getCalendarMetadataResponse({ input, init });
				return (
					metadataResponse ??
					new Response(recurringReportResponse, { status: 207 })
				);
			},
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
					guestPermissions: "manage",
					isRecurring: true,
					recurrence: {
						end: { count: 2, kind: "after_count" },
						frequency: "weekly",
						interval: 1,
						weekdays: ["mon"],
					},
					title: "Weekly planning",
				}),
			]),
		);
		expect(result.events[0]?.attendees).toEqual([
			{
				displayName: undefined,
				email: "guest@example.com",
				isOrganizer: false,
				isSelf: false,
				responseStatus: "accepted",
			},
		]);
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

	it("creates a recurring event with an RRULE and zoned wall time", async () => {
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				if (init?.method === "PROPFIND") {
					return new Response(calendarsResponse, { status: 207 });
				}

				return new Response("", { status: 201 });
			},
		);

		await createYandexCalendarEvent({
			connection,
			input: {
				calendarId: "yandex:/calendars/owner%40example.com/events-1/",
				guests: [],
				recurrence: {
					end: { date: "2026-08-31", kind: "on_date" },
					frequency: "weekly",
					interval: 2,
					timeZone: "Europe/Moscow",
					weekdays: ["mon", "wed"],
				},
				time: {
					kind: "timed",
					startAt: "2026-07-27T07:00:00.000Z",
					endAt: "2026-07-27T08:00:00.000Z",
				},
				title: "Weekly planning",
			},
			now: Date.UTC(2026, 6, 25, 10),
			request: fetchMock,
			uid: "recurring-event-123",
		});

		const putInit = fetchMock.mock.calls[1]?.[1];
		expect(putInit?.body).toContain(
			"DTSTART;TZID=Europe/Moscow:20260727T100000\r\n",
		);
		expect(putInit?.body).toContain(
			"DTEND;TZID=Europe/Moscow:20260727T110000\r\n",
		);
		expect(putInit?.body).toContain(
			"RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20260831T205959Z\r\n",
		);
	});

	it("rejects updates to events organized by someone else", async () => {
		const otherOrganizerResource = recurringCalendarResource.replace(
			"SUMMARY:Weekly planning\r\n",
			"SUMMARY:Weekly planning\r\nORGANIZER:mailto:other@example.com\r\n",
		);
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				if (init?.method === "PROPFIND") {
					return new Response(calendarsResponse, { status: 207 });
				}

				if (init?.method === "GET") {
					return new Response(otherOrganizerResource, { status: 200 });
				}

				return new Response(null, { status: 204 });
			},
		);

		await expect(
			updateYandexCalendarEvent({
				connection,
				input: {
					calendarId: "yandex:/calendars/owner%40example.com/events-1/",
					destinationCalendarId:
						"yandex:/calendars/owner%40example.com/events-1/",
					guests: ["guest@example.com"],
					providerEventId: "/calendars/owner%40example.com/events-1/weekly.ics",
					time: {
						kind: "timed",
						startAt: "2026-07-27T10:00:00.000Z",
						endAt: "2026-07-27T11:00:00.000Z",
					},
					title: "Unauthorized edit",
				},
				request: fetchMock,
			}),
		).rejects.toMatchObject({
			data: { code: "CALENDAR_EVENT_EDIT_FORBIDDEN" },
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("moves an organizer event resource to another writable calendar", async () => {
		let getCount = 0;
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				if (init?.method === "PROPFIND") {
					return new Response(calendarsWithDestinationResponse, {
						status: 207,
					});
				}
				if (init?.method === "GET") {
					getCount += 1;
					return new Response(recurringCalendarResource, {
						status: 200,
						headers: {
							etag: getCount === 1 ? '"source-etag"' : '"updated-etag"',
						},
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
					destinationCalendarId:
						"yandex:/calendars/owner%40example.com/events-2/",
					guests: ["guest@example.com"],
					providerEventId: "/calendars/owner%40example.com/events-1/weekly.ics",
					time: {
						kind: "timed",
						startAt: "2026-07-27T10:00:00.000Z",
						endAt: "2026-07-27T11:00:00.000Z",
					},
					title: "Weekly planning",
				},
				request: fetchMock,
			}),
		).resolves.toBeNull();

		const moveCall = fetchMock.mock.calls.find(
			([, init]) => init?.method === "MOVE",
		);
		expect(moveCall?.[0].toString()).toBe(
			"https://caldav.yandex.test/calendars/owner%40example.com/events-1/weekly.ics",
		);
		expect(moveCall?.[1]).toMatchObject({
			headers: {
				Destination:
					"https://caldav.yandex.test/calendars/owner%40example.com/events-2/weekly.ics",
				"If-Match": '"updated-etag"',
				Overwrite: "F",
			},
			method: "MOVE",
		});
	});

	it("declines an attendee invitation without deleting the organizer event", async () => {
		const attendeeResource = recurringCalendarResource.replace(
			"SUMMARY:Weekly planning\r\n",
			"SUMMARY:Weekly planning\r\nORGANIZER:mailto:other@example.com\r\nATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:owner@example.com\r\n",
		);
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				if (init?.method === "PROPFIND") {
					return new Response(calendarsResponse, { status: 207 });
				}
				if (init?.method === "GET") {
					return new Response(attendeeResource, {
						status: 200,
						headers: { etag: '"event-etag"' },
					});
				}
				return new Response(null, { status: 204 });
			},
		);

		await expect(
			removeYandexCalendarEvent({
				calendarId: "yandex:/calendars/owner%40example.com/events-1/",
				connection,
				providerEventId: "/calendars/owner%40example.com/events-1/weekly.ics",
				request: fetchMock,
			}),
		).resolves.toBeNull();

		const deleteCall = fetchMock.mock.calls.find(
			([, init]) => init?.method === "DELETE",
		);
		expect(deleteCall?.[1]).toMatchObject({
			headers: {
				"If-Match": '"event-etag"',
				"Schedule-Reply": "T",
			},
			method: "DELETE",
		});
	});

	it("declines one recurring attendee occurrence with an EXDATE", async () => {
		const attendeeResource = recurringCalendarResource.replace(
			"SUMMARY:Weekly planning\r\n",
			"SUMMARY:Weekly planning\r\nORGANIZER:mailto:other@example.com\r\nATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:owner@example.com\r\n",
		);
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				if (init?.method === "PROPFIND") {
					return new Response(calendarsResponse, { status: 207 });
				}
				if (init?.method === "GET") {
					return new Response(attendeeResource, {
						status: 200,
						headers: { etag: '"event-etag"' },
					});
				}
				return new Response(null, { status: 204 });
			},
		);

		await expect(
			removeYandexCalendarEvent({
				calendarId: "yandex:/calendars/owner%40example.com/events-1/",
				connection,
				providerEventId: "/calendars/owner%40example.com/events-1/weekly.ics",
				recurrenceId: "2026-08-03T10:00:00.000Z",
				request: fetchMock,
			}),
		).resolves.toBeNull();

		const putCall = fetchMock.mock.calls.find(
			([, init]) => init?.method === "PUT",
		);
		expect(String(putCall?.[1]?.body)).toContain("EXDATE:20260803T100000Z\r\n");
		expect(putCall?.[1]).toMatchObject({
			headers: {
				"If-Match": '"event-etag"',
				"Schedule-Reply": "T",
			},
			method: "PUT",
		});
	});

	it("refuses to decline an organizer-owned Yandex event", async () => {
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				if (init?.method === "PROPFIND") {
					return new Response(calendarsResponse, { status: 207 });
				}
				if (init?.method === "GET") {
					return new Response(recurringCalendarResource, {
						status: 200,
						headers: { etag: '"event-etag"' },
					});
				}
				return new Response(null, { status: 204 });
			},
		);

		await expect(
			removeYandexCalendarEvent({
				calendarId: "yandex:/calendars/owner%40example.com/events-1/",
				connection,
				providerEventId: "/calendars/owner%40example.com/events-1/weekly.ics",
				request: fetchMock,
			}),
		).rejects.toMatchObject({
			data: { code: "CALENDAR_EVENT_REMOVE_FORBIDDEN" },
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("allows an attendee to remove and add guests without editing event details", async () => {
		const attendeeResource = recurringCalendarResource.replace(
			"SUMMARY:Weekly planning\r\n",
			"SUMMARY:Weekly planning\r\nORGANIZER:mailto:other@example.com\r\nATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:owner@example.com\r\n",
		);
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				if (init?.method === "PROPFIND") {
					return new Response(calendarsResponse, { status: 207 });
				}

				if (init?.method === "GET") {
					return new Response(attendeeResource, {
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
					destinationCalendarId:
						"yandex:/calendars/owner%40example.com/events-1/",
					guests: ["new@example.com"],
					providerEventId: "/calendars/owner%40example.com/events-1/weekly.ics",
					recurrenceId: "2026-07-27T10:00:00.000Z",
					recurrenceIsAllDay: false,
					time: {
						kind: "timed",
						startAt: "2030-01-01T00:00:00.000Z",
						endAt: "2030-01-01T01:00:00.000Z",
					},
					title: "Client-supplied title must be ignored",
				},
				now: Date.UTC(2026, 6, 25, 10),
				request: fetchMock,
			}),
		).resolves.toBeNull();

		const [, putInit] = fetchMock.mock.calls[2] ?? [];
		const body = String(putInit?.body);
		const occurrenceOverride = body.slice(
			body.indexOf("RECURRENCE-ID:20260727T100000Z"),
		);
		expect(body).not.toContain("Client-supplied title must be ignored");
		expect(body).not.toContain("20300101");
		expect(body).toContain("SUMMARY:Weekly planning\r\n");
		expect(body).toContain("RECURRENCE-ID:20260727T100000Z\r\n");
		expect(body).toContain(
			"ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:owner@example.com\r\n",
		);
		expect(occurrenceOverride).not.toContain("mailto:guest@example.com");
		expect(body).toContain(
			"ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:new@example.com\r\n",
		);
	});

	it("refuses to update when CalDAV omits concurrency metadata", async () => {
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				if (init?.method === "PROPFIND") {
					return new Response(calendarsResponse, { status: 207 });
				}

				if (init?.method === "GET") {
					return new Response(recurringCalendarResource, { status: 200 });
				}

				return new Response(null, { status: 204 });
			},
		);

		await expect(
			updateYandexCalendarEvent({
				connection,
				input: {
					calendarId: "yandex:/calendars/owner%40example.com/events-1/",
					destinationCalendarId:
						"yandex:/calendars/owner%40example.com/events-1/",
					guests: ["guest@example.com"],
					providerEventId: "/calendars/owner%40example.com/events-1/weekly.ics",
					time: {
						kind: "timed",
						startAt: "2026-07-27T10:00:00.000Z",
						endAt: "2026-07-27T11:00:00.000Z",
					},
					title: "Unsafe update",
				},
				request: fetchMock,
			}),
		).rejects.toThrow("did not return an ETag");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("updates one recurring occurrence without replacing the series", async () => {
		const resourceWithAcceptedGuest = recurringCalendarResource.replace(
			"ATTENDEE;ROLE=REQ-PARTICIPANT:",
			"ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:",
		);
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				if (init?.method === "PROPFIND") {
					return new Response(calendarsResponse, { status: 207 });
				}

				if (init?.method === "GET") {
					return new Response(resourceWithAcceptedGuest, {
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
					destinationCalendarId:
						"yandex:/calendars/owner%40example.com/events-1/",
					guests: ["guest@example.com"],
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
			"ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:guest@example.com\r\n",
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

	it("deletes an organizer-owned event resource with ETag protection", async () => {
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
				request: fetchMock,
			}),
		).resolves.toBeNull();

		const [, deleteInit] = fetchMock.mock.calls[2] ?? [];
		expect(deleteInit).toMatchObject({
			headers: { "If-Match": '"event-1"' },
			method: "DELETE",
		});
	});
});
