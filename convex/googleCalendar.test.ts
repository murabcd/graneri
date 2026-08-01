import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	GOOGLE_CALENDAR_MANAGE_SCOPE,
	GOOGLE_CALENDAR_SCOPE,
	GOOGLE_CALENDAR_WRITE_SCOPE,
	type GoogleAuthContext,
} from "./googleAuth";
import {
	createGoogleCalendar,
	deleteGoogleCalendarEvent,
	fetchGoogleCalendarEvents,
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
	GOOGLE_CALENDAR_MANAGE_SCOPE:
		"https://www.googleapis.com/auth/calendar.app.created",
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
				color: "#3b82f6",
				id: "work",
				name: "Work",
				provider: "google",
			},
		]);
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
		});
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

	it("removes a partially created calendar when color setup fails", async () => {
		getGoogleAccessToken.mockResolvedValue({
			accessToken: "access-token",
			scopes: [
				GOOGLE_CALENDAR_SCOPE,
				GOOGLE_CALENDAR_WRITE_SCOPE,
				GOOGLE_CALENDAR_MANAGE_SCOPE,
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
});
