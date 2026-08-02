import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	GOOGLE_CALENDAR_LIST_MANAGE_SCOPE,
	GOOGLE_CALENDAR_MANAGE_SCOPE,
	GOOGLE_CALENDAR_SCOPE,
	GOOGLE_CALENDAR_WRITE_SCOPE,
	type GoogleAuthContext,
} from "./googleAuth";
import {
	createGoogleCalendar,
	createGoogleCalendarEvent,
	deleteGoogleCalendarEvent,
	fetchGoogleCalendarEvents,
	removeGoogleCalendar,
	removeGoogleCalendarEvent,
	updateGoogleCalendar,
	updateGoogleCalendarEvent,
} from "./googleCalendar";

const {
	fetchGoogleJsonWithRetry,
	fetchGoogleResponseWithRetry,
	getGoogleAccessToken,
} = vi.hoisted(() => ({
	fetchGoogleJsonWithRetry: vi.fn(),
	fetchGoogleResponseWithRetry: vi.fn(),
	getGoogleAccessToken: vi.fn(),
}));

vi.mock("./googleAuth", () => ({
	fetchGoogleJsonWithRetry,
	fetchGoogleResponseWithRetry,
	GOOGLE_CALENDAR_LIST_MANAGE_SCOPE:
		"https://www.googleapis.com/auth/calendar.calendarlist",
	GOOGLE_CALENDAR_MANAGE_SCOPE:
		"https://www.googleapis.com/auth/calendar.calendars",
	GOOGLE_CALENDAR_SCOPE: "https://www.googleapis.com/auth/calendar.readonly",
	GOOGLE_CALENDAR_WRITE_SCOPE:
		"https://www.googleapis.com/auth/calendar.events",
	getGoogleAccessToken,
}));

const authContext = {} as GoogleAuthContext;

describe("Google Calendar provider", () => {
	beforeEach(() => {
		fetchGoogleJsonWithRetry.mockReset();
		fetchGoogleResponseWithRetry.mockReset();
		getGoogleAccessToken.mockReset();
		getGoogleAccessToken.mockResolvedValue({
			accessToken: "access-token",
			scopes: [GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE],
		});
	});

	it("preserves the provider calendar color", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [
					{
						accessRole: "owner",
						backgroundColor: "#3b82f6",
						id: "work",
						primary: true,
						summary: "Work",
					},
				],
			})
			.mockResolvedValueOnce({ items: [] });

		const result = await fetchGoogleCalendarEvents({
			authContext,
			eventLimit: 25,
			minimumEndAt: 0,
			timeMax: "2026-08-01T00:00:00.000Z",
			timeMin: "2026-07-01T00:00:00.000Z",
		});

		expect(result.calendars).toEqual([
			{
				canCreateEvents: true,
				canEdit: false,
				canSetDefault: false,
				color: "#3b82f6",
				id: "work",
				name: "Work",
				provider: "google",
				removalMode: "none",
				requiresEventMove: false,
			},
		]);
	});

	it("creates a recurring event with an RRULE and time zone", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [
					{
						accessRole: "owner",
						id: "work",
						primary: true,
					},
				],
			})
			.mockResolvedValueOnce({ id: "recurring-event-1" });

		await expect(
			createGoogleCalendarEvent({
				authContext,
				input: {
					calendarId: "work",
					guests: [],
					recurrence: {
						end: { kind: "never" },
						frequency: "weekly",
						interval: 2,
						timeZone: "Europe/Moscow",
						weekdays: ["mon", "wed"],
					},
					time: {
						kind: "timed",
						endAt: "2026-08-03T08:00:00.000Z",
						startAt: "2026-08-03T07:00:00.000Z",
					},
					title: "Weekly planning",
				},
			}),
		).resolves.toEqual({ id: "recurring-event-1" });

		const createInit = fetchGoogleJsonWithRetry.mock.calls[1]?.[3];
		expect(JSON.parse(String(createInit?.body))).toEqual({
			attendees: [],
			end: {
				dateTime: "2026-08-03T08:00:00.000Z",
				timeZone: "Europe/Moscow",
			},
			recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"],
			start: {
				dateTime: "2026-08-03T07:00:00.000Z",
				timeZone: "Europe/Moscow",
			},
			summary: "Weekly planning",
		});
	});

	it("normalizes attendee identity, roles, and response state", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [
					{
						accessRole: "owner",
						backgroundColor: "#3b82f6",
						id: "work",
						primary: true,
						summary: "Work",
					},
				],
			})
			.mockResolvedValueOnce({
				items: [
					{
						attendees: [
							{
								displayName: "Mark Stone",
								email: "MARK@ACME.COM",
								responseStatus: "accepted",
							},
							{
								email: "owner@example.com",
								responseStatus: "accepted",
								self: true,
							},
						],
						end: { dateTime: "2026-07-27T11:00:00.000Z" },
						id: "meeting-1",
						organizer: {
							email: "owner@example.com",
							self: true,
						},
						start: { dateTime: "2026-07-27T10:00:00.000Z" },
						summary: "Customer review",
					},
				],
			});

		const result = await fetchGoogleCalendarEvents({
			authContext,
			eventLimit: 25,
			minimumEndAt: 0,
			timeMax: "2026-08-01T00:00:00.000Z",
			timeMin: "2026-07-01T00:00:00.000Z",
		});

		expect(result.events[0]?.attendees).toEqual([
			{
				displayName: "Mark Stone",
				email: "mark@acme.com",
				isOrganizer: false,
				isSelf: false,
				responseStatus: "accepted",
			},
			{
				displayName: undefined,
				email: "owner@example.com",
				isOrganizer: true,
				isSelf: true,
				responseStatus: "accepted",
			},
		]);
		expect(result.events[0]).toMatchObject({
			canDelete: true,
			canEdit: true,
			canMove: true,
			canRemove: false,
		});
	});

	it("resolves recurrence rules from the parent of expanded instances", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [
					{
						accessRole: "owner",
						backgroundColor: "#3b82f6",
						id: "work",
						primary: true,
						summary: "Work",
					},
				],
			})
			.mockResolvedValueOnce({
				items: [
					{
						end: { dateTime: "2026-08-03T11:00:00+03:00" },
						id: "instance-1",
						recurringEventId: "series-1",
						start: { dateTime: "2026-08-03T10:00:00+03:00" },
						summary: "Team sync",
					},
				],
			})
			.mockResolvedValueOnce({
				id: "series-1",
				recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=8"],
				start: { dateTime: "2026-08-03T10:00:00+03:00" },
			});

		const result = await fetchGoogleCalendarEvents({
			authContext,
			eventLimit: 25,
			minimumEndAt: 0,
			timeMax: "2026-09-01T00:00:00.000Z",
			timeMin: "2026-08-01T00:00:00.000Z",
		});

		expect(result.events[0]?.recurrence).toEqual({
			end: { count: 8, kind: "after_count" },
			frequency: "weekly",
			interval: 2,
			weekdays: ["mon", "wed"],
		});
		expect(fetchGoogleJsonWithRetry.mock.calls[2]?.[2]).toMatchObject({
			pathname: "/calendar/v3/calendars/work/events/series-1",
		});
	});

	it("exposes guest editing without exposing organizer deletion", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [
					{
						accessRole: "owner",
						backgroundColor: "#3b82f6",
						id: "work",
						primary: true,
						summary: "Work",
					},
				],
			})
			.mockResolvedValueOnce({
				items: [
					{
						end: { dateTime: "2026-07-27T11:00:00.000Z" },
						guestsCanModify: true,
						id: "meeting-1",
						organizer: { email: "organizer@example.com", self: false },
						start: { dateTime: "2026-07-27T10:00:00.000Z" },
						summary: "Customer review",
					},
				],
			});

		const result = await fetchGoogleCalendarEvents({
			authContext,
			eventLimit: 25,
			minimumEndAt: 0,
			timeMax: "2026-08-01T00:00:00.000Z",
			timeMin: "2026-07-01T00:00:00.000Z",
		});

		expect(result.events[0]).toMatchObject({
			canDelete: false,
			canEdit: true,
			guestPermissions: "manage",
		});
	});

	it("exposes guest-only editing when an attendee may invite others", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [
					{
						accessRole: "owner",
						backgroundColor: "#3b82f6",
						id: "work",
						primary: true,
						summary: "Work",
					},
				],
			})
			.mockResolvedValueOnce({
				items: [
					{
						attendees: [{ email: "owner@example.com", self: true }],
						end: { dateTime: "2026-07-27T11:00:00.000Z" },
						id: "meeting-1",
						organizer: { email: "organizer@example.com", self: false },
						start: { dateTime: "2026-07-27T10:00:00.000Z" },
						summary: "Customer review",
					},
				],
			});

		const result = await fetchGoogleCalendarEvents({
			authContext,
			eventLimit: 25,
			minimumEndAt: 0,
			timeMax: "2026-08-01T00:00:00.000Z",
			timeMin: "2026-07-01T00:00:00.000Z",
		});

		expect(result.events[0]).toMatchObject({
			canDelete: false,
			canEdit: false,
			guestPermissions: "invite",
			canMove: false,
			canRemove: true,
		});
	});

	it("moves an organizer-owned event to another writable calendar", async () => {
		const calendars = {
			items: [
				{ accessRole: "owner", id: "work", primary: true },
				{ accessRole: "owner", id: "personal" },
			],
		};
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce(calendars)
			.mockResolvedValueOnce({
				etag: '"source-etag"',
				id: "event-1",
				organizer: { self: true },
			})
			.mockResolvedValueOnce(calendars)
			.mockResolvedValueOnce({
				etag: '"updated-etag"',
				id: "event-1",
			})
			.mockResolvedValueOnce({ id: "event-1" });

		await expect(
			updateGoogleCalendarEvent({
				authContext,
				input: {
					calendarId: "work",
					destinationCalendarId: "personal",
					guests: [],
					providerEventId: "event-1",
					time: {
						kind: "timed",
						endAt: "2026-07-27T11:00:00.000Z",
						startAt: "2026-07-27T10:00:00.000Z",
					},
					title: "Planning",
				},
			}),
		).resolves.toBeNull();

		const [, , moveUrl, moveInit] =
			fetchGoogleJsonWithRetry.mock.calls[4] ?? [];
		expect(String(moveUrl)).toContain("/calendars/work/events/event-1/move");
		expect(String(moveUrl)).toContain("destination=personal");
		expect(String(moveUrl)).toContain("sendUpdates=all");
		expect(moveInit).toMatchObject({
			headers: { "If-Match": '"updated-etag"' },
			method: "POST",
		});
	});

	it("rejects an attendee calendar move before treating it as a no-op", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [{ accessRole: "owner", id: "work", primary: true }],
			})
			.mockResolvedValueOnce({
				attendees: [{ email: "owner@example.com", self: true }],
				etag: '"event-etag"',
				id: "event-1",
				organizer: { self: false },
			});

		await expect(
			updateGoogleCalendarEvent({
				authContext,
				input: {
					calendarId: "work",
					destinationCalendarId: "personal",
					guests: [],
					providerEventId: "event-1",
					time: {
						kind: "timed",
						endAt: "2026-07-27T11:00:00.000Z",
						startAt: "2026-07-27T10:00:00.000Z",
					},
					title: "Planning",
				},
			}),
		).rejects.toMatchObject({
			data: { code: "CALENDAR_EVENT_MOVE_FORBIDDEN" },
		});
		expect(fetchGoogleJsonWithRetry).toHaveBeenCalledTimes(2);
	});

	it("removes an attendee event copy without cancelling the organizer event", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [{ accessRole: "owner", id: "work", primary: true }],
			})
			.mockResolvedValueOnce({
				attendees: [{ email: "owner@example.com", self: true }],
				etag: '"event-etag"',
				id: "event-1",
				organizer: { self: false },
			});
		fetchGoogleResponseWithRetry.mockResolvedValue(
			new Response(null, { status: 204 }),
		);

		await expect(
			removeGoogleCalendarEvent({
				authContext,
				calendarId: "work",
				providerEventId: "event-1",
			}),
		).resolves.toBeNull();

		const [, , removeUrl, removeInit] =
			fetchGoogleResponseWithRetry.mock.calls[0] ?? [];
		expect(String(removeUrl)).toContain("sendUpdates=all");
		expect(removeInit).toMatchObject({
			headers: { "If-Match": '"event-etag"' },
			method: "DELETE",
		});
	});

	it("refuses to remove an organizer-owned event through the attendee path", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [{ accessRole: "owner", id: "work", primary: true }],
			})
			.mockResolvedValueOnce({
				attendees: [{ email: "owner@example.com", self: true }],
				etag: '"event-etag"',
				id: "event-1",
				organizer: { self: true },
			});

		await expect(
			removeGoogleCalendarEvent({
				authContext,
				calendarId: "work",
				providerEventId: "event-1",
			}),
		).rejects.toMatchObject({
			data: { code: "CALENDAR_EVENT_REMOVE_FORBIDDEN" },
		});
		expect(fetchGoogleResponseWithRetry).not.toHaveBeenCalled();
	});

	it("rechecks organizer permissions and preserves guest responses on update", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [{ accessRole: "owner", id: "work", primary: true }],
			})
			.mockResolvedValueOnce({
				attendees: [
					{
						email: "accepted@example.com",
						responseStatus: "accepted",
					},
					{ email: "removed@example.com", responseStatus: "tentative" },
				],
				etag: '"event-etag"',
				id: "event-1",
				organizer: { self: true },
			})
			.mockResolvedValueOnce({ id: "event-1" });

		await expect(
			updateGoogleCalendarEvent({
				authContext,
				input: {
					calendarId: "work",
					destinationCalendarId: "work",
					guests: ["accepted@example.com", "new@example.com"],
					providerEventId: "event-1",
					time: {
						kind: "timed",
						endAt: "2026-07-27T11:30:00.000Z",
						startAt: "2026-07-27T10:30:00.000Z",
					},
					title: "Updated review",
				},
			}),
		).resolves.toBeNull();

		const [, , updateUrl, updateInit] =
			fetchGoogleJsonWithRetry.mock.calls[2] ?? [];
		expect(String(updateUrl)).toContain("sendUpdates=all");
		expect(updateInit).toMatchObject({
			headers: {
				"If-Match": '"event-etag"',
			},
			method: "PATCH",
		});
		expect(JSON.parse(String(updateInit?.body))).toMatchObject({
			attendees: [
				{ email: "accepted@example.com", responseStatus: "accepted" },
				{ email: "new@example.com" },
			],
			summary: "Updated review",
		});
	});

	it("limits invite-only attendee updates to additive guests", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [{ accessRole: "owner", id: "work", primary: true }],
			})
			.mockResolvedValueOnce({
				attendees: [
					{ email: "owner@example.com", self: true },
					{ email: "accepted@example.com", responseStatus: "accepted" },
					{ email: "retained@example.com", responseStatus: "tentative" },
				],
				etag: '"event-etag"',
				id: "event-1",
				organizer: { self: false },
			})
			.mockResolvedValueOnce({ id: "event-1" });

		await expect(
			updateGoogleCalendarEvent({
				authContext,
				input: {
					calendarId: "work",
					destinationCalendarId: "work",
					guests: ["accepted@example.com", "new@example.com"],
					providerEventId: "event-1",
					time: {
						kind: "timed",
						endAt: "2026-07-27T13:00:00.000Z",
						startAt: "2026-07-27T12:00:00.000Z",
					},
					title: "Client-supplied title must be ignored",
				},
			}),
		).resolves.toBeNull();

		const updateInit = fetchGoogleJsonWithRetry.mock.calls[2]?.[3];
		expect(JSON.parse(String(updateInit?.body))).toEqual({
			attendees: [
				{ email: "owner@example.com" },
				{ email: "accepted@example.com", responseStatus: "accepted" },
				{ email: "retained@example.com", responseStatus: "tentative" },
				{ email: "new@example.com" },
			],
		});
	});

	it("refuses to update when the provider omits concurrency metadata", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [{ accessRole: "owner", id: "work", primary: true }],
			})
			.mockResolvedValueOnce({
				id: "event-1",
				organizer: { self: true },
			});

		await expect(
			updateGoogleCalendarEvent({
				authContext,
				input: {
					calendarId: "work",
					destinationCalendarId: "work",
					guests: [],
					providerEventId: "event-1",
					time: {
						kind: "timed",
						endAt: "2026-07-27T11:30:00.000Z",
						startAt: "2026-07-27T10:30:00.000Z",
					},
					title: "Unsafe update",
				},
			}),
		).rejects.toThrow("did not return an ETag");
		expect(fetchGoogleJsonWithRetry).toHaveBeenCalledTimes(2);
	});

	it("refuses to delete an event organized by someone else", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [{ accessRole: "owner", id: "work", primary: true }],
			})
			.mockResolvedValueOnce({
				id: "event-1",
				organizer: { email: "organizer@example.com", self: false },
			});

		await expect(
			deleteGoogleCalendarEvent({
				authContext,
				calendarId: "work",
				providerEventId: "event-1",
			}),
		).rejects.toMatchObject({
			data: { code: "CALENDAR_EVENT_DELETE_FORBIDDEN" },
		});
		expect(fetchGoogleResponseWithRetry).not.toHaveBeenCalled();
	});

	it("allows delegated writers to manage shared-calendar events", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [{ accessRole: "writer", id: "shared" }],
			})
			.mockResolvedValueOnce({
				etag: '"event-etag"',
				id: "event-1",
				organizer: { self: false },
			});
		fetchGoogleResponseWithRetry.mockResolvedValue(new Response(null));

		await expect(
			deleteGoogleCalendarEvent({
				authContext,
				calendarId: "shared",
				providerEventId: "event-1",
			}),
		).resolves.toBeNull();
	});

	it("deletes an organizer-owned event with notifications and concurrency protection", async () => {
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [{ accessRole: "owner", id: "work" }],
			})
			.mockResolvedValueOnce({
				etag: '"event-etag"',
				id: "event-1",
				organizer: { self: true },
			});
		fetchGoogleResponseWithRetry.mockResolvedValue(new Response(null));

		await expect(
			deleteGoogleCalendarEvent({
				authContext,
				calendarId: "work",
				providerEventId: "event-1",
			}),
		).resolves.toBeNull();

		expect(fetchGoogleResponseWithRetry).toHaveBeenCalledWith(
			authContext,
			expect.objectContaining({ accessToken: "access-token" }),
			expect.objectContaining({
				pathname: "/calendar/v3/calendars/work/events/event-1",
				search: "?sendUpdates=all",
			}),
			{
				headers: { "If-Match": '"event-etag"' },
				method: "DELETE",
			},
		);
	});

	it("rejects incomplete calendar reads instead of returning a partial agenda", async () => {
		const providerError = new Error("Calendar events unavailable");
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [
					{
						accessRole: "owner",
						backgroundColor: "#3b82f6",
						id: "work",
						summary: "Work",
					},
				],
			})
			.mockRejectedValueOnce(providerError);

		await expect(
			fetchGoogleCalendarEvents({
				authContext,
				eventLimit: 25,
				minimumEndAt: 0,
				timeMax: "2026-08-01T00:00:00.000Z",
				timeMin: "2026-07-01T00:00:00.000Z",
			}),
		).rejects.toBe(providerError);
	});

	it("creates a real secondary Google calendar and applies its list color", async () => {
		getGoogleAccessToken.mockResolvedValue({
			accessToken: "access-token",
			scopes: [
				GOOGLE_CALENDAR_SCOPE,
				GOOGLE_CALENDAR_WRITE_SCOPE,
				GOOGLE_CALENDAR_MANAGE_SCOPE,
				GOOGLE_CALENDAR_LIST_MANAGE_SCOPE,
			],
		});
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({ id: "created-calendar" })
			.mockResolvedValueOnce({ id: "created-calendar" });

		await expect(
			createGoogleCalendar({
				authContext,
				color: "#3b82f6",
				name: "Projects",
			}),
		).resolves.toEqual({ id: "created-calendar" });
		expect(fetchGoogleJsonWithRetry).toHaveBeenNthCalledWith(
			1,
			authContext,
			expect.anything(),
			expect.objectContaining({ pathname: "/calendar/v3/calendars" }),
			expect.objectContaining({
				body: JSON.stringify({ summary: "Projects" }),
				method: "POST",
			}),
		);
		expect(fetchGoogleJsonWithRetry).toHaveBeenNthCalledWith(
			2,
			authContext,
			expect.anything(),
			expect.objectContaining({
				pathname: "/calendar/v3/users/me/calendarList/created-calendar",
			}),
			expect.objectContaining({
				body: JSON.stringify({
					backgroundColor: "#3b82f6",
					foregroundColor: "#ffffff",
					selected: true,
				}),
				method: "PATCH",
			}),
		);
	});

	it("removes a partially created calendar when color setup fails", async () => {
		getGoogleAccessToken.mockResolvedValue({
			accessToken: "access-token",
			scopes: [
				GOOGLE_CALENDAR_SCOPE,
				GOOGLE_CALENDAR_WRITE_SCOPE,
				GOOGLE_CALENDAR_MANAGE_SCOPE,
				GOOGLE_CALENDAR_LIST_MANAGE_SCOPE,
			],
		});
		const colorError = new Error("Color update failed");
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({ id: "created-calendar" })
			.mockRejectedValueOnce(colorError);
		fetchGoogleResponseWithRetry.mockResolvedValue(new Response(null));

		await expect(
			createGoogleCalendar({
				authContext,
				color: "#3b82f6",
				name: "Projects",
			}),
		).rejects.toBe(colorError);
		expect(fetchGoogleResponseWithRetry).toHaveBeenCalledWith(
			authContext,
			expect.objectContaining({ accessToken: "access-token" }),
			expect.objectContaining({
				pathname: "/calendar/v3/calendars/created-calendar",
			}),
			{ method: "DELETE" },
		);
	});

	it("reports owned secondary calendar management capabilities", async () => {
		getGoogleAccessToken.mockResolvedValue({
			accessToken: "access-token",
			scopes: [
				GOOGLE_CALENDAR_SCOPE,
				GOOGLE_CALENDAR_WRITE_SCOPE,
				GOOGLE_CALENDAR_MANAGE_SCOPE,
				GOOGLE_CALENDAR_LIST_MANAGE_SCOPE,
			],
		});
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [
					{
						accessRole: "owner",
						backgroundColor: "#3b82f6",
						id: "projects",
						summary: "Projects",
					},
				],
			})
			.mockResolvedValueOnce({ items: [] });

		const result = await fetchGoogleCalendarEvents({
			authContext,
			eventLimit: 25,
			minimumEndAt: 0,
			timeMax: "2026-08-01T00:00:00.000Z",
			timeMin: "2026-07-01T00:00:00.000Z",
		});

		expect(result.calendars[0]).toMatchObject({
			canEdit: true,
			removalMode: "delete",
			requiresEventMove: true,
		});
	});

	it("does not expose owned-calendar actions with partial management scopes", async () => {
		getGoogleAccessToken.mockResolvedValue({
			accessToken: "access-token",
			scopes: [GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_LIST_MANAGE_SCOPE],
		});
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				items: [
					{
						accessRole: "owner",
						backgroundColor: "#3b82f6",
						id: "projects",
						summary: "Projects",
					},
				],
			})
			.mockResolvedValueOnce({ items: [] });

		const result = await fetchGoogleCalendarEvents({
			authContext,
			eventLimit: 25,
			minimumEndAt: 0,
			timeMax: "2026-08-01T00:00:00.000Z",
			timeMin: "2026-07-01T00:00:00.000Z",
		});

		expect(result.calendars[0]).toMatchObject({
			canEdit: false,
			removalMode: "none",
			requiresEventMove: false,
		});
	});

	it("updates the provider name and calendar-list color", async () => {
		getGoogleAccessToken.mockResolvedValue({
			accessToken: "access-token",
			scopes: [
				GOOGLE_CALENDAR_SCOPE,
				GOOGLE_CALENDAR_MANAGE_SCOPE,
				GOOGLE_CALENDAR_LIST_MANAGE_SCOPE,
			],
		});
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				accessRole: "owner",
				id: "projects",
				summary: "Projects",
			})
			.mockResolvedValueOnce({ id: "projects" })
			.mockResolvedValueOnce({ id: "projects" });

		await expect(
			updateGoogleCalendar({
				authContext,
				calendarId: "projects",
				color: "#10b981",
				name: "Roadmap",
			}),
		).resolves.toBeNull();
		expect(fetchGoogleJsonWithRetry).toHaveBeenNthCalledWith(
			2,
			authContext,
			expect.anything(),
			expect.objectContaining({
				pathname: "/calendar/v3/calendars/projects",
			}),
			expect.objectContaining({
				body: JSON.stringify({ summary: "Roadmap" }),
				method: "PATCH",
			}),
		);
		expect(fetchGoogleJsonWithRetry).toHaveBeenNthCalledWith(
			3,
			authContext,
			expect.anything(),
			expect.objectContaining({
				pathname: "/calendar/v3/users/me/calendarList/projects",
			}),
			expect.objectContaining({ method: "PATCH" }),
		);
	});

	it("unsubscribes a non-owned calendar without deleting provider data", async () => {
		getGoogleAccessToken.mockResolvedValue({
			accessToken: "access-token",
			scopes: [GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_LIST_MANAGE_SCOPE],
		});
		fetchGoogleJsonWithRetry.mockResolvedValueOnce({
			accessRole: "reader",
			id: "shared",
			summary: "Shared",
		});
		fetchGoogleResponseWithRetry.mockResolvedValue(new Response(null));

		await expect(
			removeGoogleCalendar({ authContext, calendarId: "shared" }),
		).resolves.toBeNull();
		expect(fetchGoogleResponseWithRetry).toHaveBeenCalledWith(
			authContext,
			expect.anything(),
			expect.objectContaining({
				pathname: "/calendar/v3/users/me/calendarList/shared",
			}),
			{ method: "DELETE" },
		);
	});

	it("moves every event before deleting an owned secondary calendar", async () => {
		getGoogleAccessToken.mockResolvedValue({
			accessToken: "access-token",
			scopes: [
				GOOGLE_CALENDAR_SCOPE,
				GOOGLE_CALENDAR_WRITE_SCOPE,
				GOOGLE_CALENDAR_MANAGE_SCOPE,
				GOOGLE_CALENDAR_LIST_MANAGE_SCOPE,
			],
		});
		fetchGoogleJsonWithRetry
			.mockResolvedValueOnce({
				accessRole: "owner",
				id: "projects",
				summary: "Projects",
			})
			.mockResolvedValueOnce({
				items: [{ accessRole: "owner", id: "archive" }],
			})
			.mockResolvedValueOnce({ items: [{ id: "event-1" }] })
			.mockResolvedValueOnce({ id: "event-1" });
		fetchGoogleResponseWithRetry.mockResolvedValue(new Response(null));

		await expect(
			removeGoogleCalendar({
				authContext,
				calendarId: "projects",
				destinationCalendarId: "archive",
			}),
		).resolves.toBeNull();
		expect(fetchGoogleJsonWithRetry).toHaveBeenLastCalledWith(
			authContext,
			expect.anything(),
			expect.objectContaining({
				pathname: "/calendar/v3/calendars/projects/events/event-1/move",
			}),
			{ method: "POST" },
		);
		expect(fetchGoogleResponseWithRetry).toHaveBeenCalledWith(
			authContext,
			expect.anything(),
			expect.objectContaining({
				pathname: "/calendar/v3/calendars/projects",
			}),
			{ method: "DELETE" },
		);
	});
});
