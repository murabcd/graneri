import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	GOOGLE_CALENDAR_MANAGE_SCOPE,
	GOOGLE_CALENDAR_SCOPE,
	GOOGLE_CALENDAR_WRITE_SCOPE,
	type GoogleAuthContext,
} from "./googleAuth";
import {
	createGoogleCalendar,
	fetchGoogleCalendarEvents,
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
