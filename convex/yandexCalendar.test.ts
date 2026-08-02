import { describe, expect, it, vi } from "vitest";
import {
	createYandexCalendar,
	listYandexUpcomingEvents,
	removeYandexCalendar,
	setDefaultYandexCalendar,
	updateYandexCalendar,
} from "./yandexCalendar";
import {
	calendarsResponse,
	calendarsWithDestinationResponse,
	connection,
	emptyReportResponse,
	getCalendarMetadataResponse,
	schedulingInboxPath,
	schedulingInboxResponse,
	schedulingPrincipalResponse,
} from "./yandexCalendar.fixtures";

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
			async (input: string | URL | Request, init?: RequestInit) => {
				const metadataResponse = getCalendarMetadataResponse({ input, init });
				if (metadataResponse) {
					return metadataResponse;
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
					canEdit: true,
					canSetDefault: true,
					color: "#10B981",
					id: "yandex:/calendars/owner%40example.com/events-1/",
					name: "Personal",
					provider: "yandex",
					removalMode: "delete",
					requiresEventMove: true,
				},
			],
			connectedCalendarCount: 1,
			events: [],
		});
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("exposes deletion without relying on a parent unbind privilege", async () => {
		const listingWithoutHomePrivileges = calendarsResponse
			.replace(
				`\t\t\t\t<d:current-user-privilege-set>
\t\t\t\t\t<d:privilege><d:unbind /></d:privilege>
\t\t\t\t</d:current-user-privilege-set>
`,
				"",
			)
			.replace(
				"/calendars/owner%40example.com/</d:href>",
				"/calendars/owner@example.com</d:href>",
			);
		const fetchMock = vi.fn(
			async (input: string | URL | Request, init?: RequestInit) => {
				const metadataResponse = getCalendarMetadataResponse({
					calendarsXml: listingWithoutHomePrivileges,
					input,
					init,
				});
				if (metadataResponse) {
					return metadataResponse;
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

		expect(result.calendars[0]).toMatchObject({
			canEdit: true,
			removalMode: "delete",
			requiresEventMove: true,
		});
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("updates calendar name and color through CalDAV properties", async () => {
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) =>
				new Response(init?.method === "PROPFIND" ? calendarsResponse : "", {
					status: 207,
				}),
		);

		await expect(
			updateYandexCalendar({
				calendarId: "yandex:/calendars/owner%40example.com/events-1/",
				color: "#3b82f6",
				connection,
				name: "Roadmap & launches",
				request: fetchMock,
			}),
		).resolves.toBeNull();
		const [, updateInit] = fetchMock.mock.calls[1] ?? [];
		expect(updateInit).toMatchObject({ method: "PROPPATCH" });
		expect(updateInit?.body).toContain(
			"<d:displayname>Roadmap &amp; launches</d:displayname>",
		);
		expect(updateInit?.body).toContain(
			"<a:calendar-color>#3B82F6FF</a:calendar-color>",
		);
	});

	it("sets and verifies the default calendar through the scheduling inbox", async () => {
		let inboxReadCount = 0;
		const fetchMock = vi.fn(
			async (input: string | URL | Request, init?: RequestInit) => {
				const url = String(input);
				if (
					init?.method === "PROPFIND" &&
					url.endsWith("/principals/users/owner@example.com/")
				) {
					return new Response(schedulingPrincipalResponse, { status: 207 });
				}
				if (init?.method === "PROPFIND" && url.endsWith(schedulingInboxPath)) {
					inboxReadCount += 1;
					return new Response(
						schedulingInboxResponse(
							inboxReadCount === 1
								? "/calendars/owner%40example.com/events-default/"
								: "/calendars/owner%40example.com/events-1/",
						),
						{ status: 207 },
					);
				}
				if (init?.method === "PROPFIND") {
					return new Response(calendarsResponse, { status: 207 });
				}
				return new Response(
					`<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
					{ status: 207 },
				);
			},
		);

		await expect(
			setDefaultYandexCalendar({
				calendarId: "yandex:/calendars/owner%40example.com/events-1/",
				connection,
				request: fetchMock,
			}),
		).resolves.toBeNull();

		const [patchUrl, patchInit] =
			fetchMock.mock.calls.find(([, init]) => init?.method === "PROPPATCH") ??
			[];
		expect(String(patchUrl)).toBe(
			"https://caldav.yandex.test/calendars/owner%40example.com/inbox/",
		);
		expect(patchInit?.body).toContain(
			"<d:href>/calendars/owner%40example.com/events-1/</d:href>",
		);
		expect(inboxReadCount).toBe(2);
	});

	it("moves every resource before deleting a non-default calendar", async () => {
		const sourceResources = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
	<d:response><d:href>/calendars/owner%40example.com/events-1/</d:href><d:propstat><d:prop><d:resourcetype><d:collection /></d:resourcetype></d:prop></d:propstat></d:response>
	<d:response><d:href>/calendars/owner%40example.com/events-1/event-1.ics</d:href><d:propstat><d:prop><d:resourcetype /></d:prop></d:propstat></d:response>
</d:multistatus>`;
		const destinationResources = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
	<d:response><d:href>/calendars/owner%40example.com/events-2/</d:href><d:propstat><d:prop><d:resourcetype><d:collection /></d:resourcetype></d:prop></d:propstat></d:response>
</d:multistatus>`;
		const fetchMock = vi.fn(
			async (input: string | URL | Request, init?: RequestInit) => {
				const url = String(input);
				const metadataResponse = getCalendarMetadataResponse({
					calendarsXml: calendarsWithDestinationResponse,
					input,
					init,
				});
				if (metadataResponse) {
					return metadataResponse;
				}
				if (init?.method === "PROPFIND" && url.endsWith("/events-1/")) {
					return new Response(sourceResources, { status: 207 });
				}
				if (init?.method === "PROPFIND" && url.endsWith("/events-2/")) {
					return new Response(destinationResources, { status: 207 });
				}
				return new Response(init?.method === "DELETE" ? null : "", {
					status: init?.method === "DELETE" ? 204 : 201,
				});
			},
		);

		await expect(
			removeYandexCalendar({
				calendarId: "yandex:/calendars/owner%40example.com/events-1/",
				connection,
				destinationCalendarId:
					"yandex:/calendars/owner%40example.com/events-2/",
				request: fetchMock,
			}),
		).resolves.toBeNull();
		const [moveUrl, moveInit] =
			fetchMock.mock.calls.find(([, init]) => init?.method === "MOVE") ?? [];
		expect(String(moveUrl)).toBe(
			"https://caldav.yandex.test/calendars/owner%40example.com/events-1/event-1.ics",
		);
		expect(moveInit).toMatchObject({
			headers: {
				Destination:
					"https://caldav.yandex.test/calendars/owner%40example.com/events-2/event-1.ics",
				Overwrite: "F",
			},
			method: "MOVE",
		});
		const [deleteUrl, deleteInit] = fetchMock.mock.calls.at(-1) ?? [];
		expect(String(deleteUrl)).toBe(
			"https://caldav.yandex.test/calendars/owner%40example.com/events-1/",
		);
		expect(deleteInit).toMatchObject({ method: "DELETE" });
	});

	it("keeps a read-only CalDAV collection out of event creation", async () => {
		const readOnlyCalendarsResponse = calendarsResponse.replace(
			"<d:write-content />",
			"<d:read />",
		);
		const fetchMock = vi.fn(
			async (input: string | URL | Request, init?: RequestInit) => {
				const metadataResponse = getCalendarMetadataResponse({
					calendarsXml: readOnlyCalendarsResponse,
					input,
					init,
				});
				return (
					metadataResponse ?? new Response(emptyReportResponse, { status: 207 })
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

		expect(result.calendars[0]?.canCreateEvents).toBe(false);
		expect(result.calendars[0]?.removalMode).toBe("none");
	});

	it("never exposes deletion for the default Yandex calendar", async () => {
		const defaultCalendarResponse = calendarsResponse.replaceAll(
			"events-1",
			"events-default",
		);
		const fetchMock = vi.fn(
			async (input: string | URL | Request, init?: RequestInit) => {
				const metadataResponse = getCalendarMetadataResponse({
					calendarsXml: defaultCalendarResponse,
					defaultCalendarPath: "/calendars/owner%40example.com/events-default/",
					input,
					init,
				});
				return (
					metadataResponse ?? new Response(emptyReportResponse, { status: 207 })
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

		expect(result.calendars[0]).toMatchObject({
			canEdit: true,
			canSetDefault: false,
			removalMode: "none",
			requiresEventMove: false,
		});
	});
});
