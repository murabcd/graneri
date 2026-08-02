import { describe, expect, it, vi } from "vitest";
import {
	type CalendarProviderAdapter,
	createCalendarProviderModule,
} from "./calendarProviderModule";
import type {
	CalendarEventDetailsInput,
	CalendarEventsFetchResult,
	CalendarProvider,
	UpcomingCalendarEvent,
	UpdateCalendarEventInput,
} from "./calendarTypes";

const readInput = {
	eventLimit: 25,
	minimumEndAt: 1_700_000_000_000,
	timeMax: 1_700_086_400_000,
	timeMin: 1_700_000_000_000,
};

const createEvent = ({
	id,
	provider,
	startAt,
}: {
	id: string;
	provider: CalendarProvider;
	startAt: string;
}): UpcomingCalendarEvent => ({
	attendees: [],
	canDelete: true,
	canEdit: true,
	guestPermissions: "manage",
	canMove: true,
	canRemove: false,
	calendarId: `${provider}-calendar`,
	calendarName: `${provider} calendar`,
	endAt: "2026-07-27T11:00:00.000Z",
	id,
	isAllDay: false,
	isMeeting: true,
	isRecurring: false,
	provider,
	providerEventId: `${provider}-${id}`,
	startAt,
	title: `${provider} event`,
});

const createResult = ({
	events,
	provider,
}: {
	events: UpcomingCalendarEvent[];
	provider: CalendarProvider;
}): CalendarEventsFetchResult => ({
	calendars: [
		{
			canCreateEvents: true,
			canEdit: true,
			canSetDefault: provider === "yandex",
			color: provider === "google" ? "#3b82f6" : "#10b981",
			id: `${provider}-calendar`,
			name: `${provider} calendar`,
			provider,
			removalMode: "delete",
			requiresEventMove: true,
		},
	],
	connectedCalendarCount: 1,
	events,
});

const createProviderAdapter = (
	result: CalendarEventsFetchResult,
	overrides: Partial<CalendarProviderAdapter> = {},
): CalendarProviderAdapter => ({
	createCalendar: vi.fn(async () => ({ id: "calendar-id" })),
	createEvent: vi.fn(async () => ({ id: "event-id" })),
	removeCalendar: vi.fn(async () => null),
	deleteEvent: vi.fn(async () => null),
	listEvents: vi.fn(async () => result),
	removeEvent: vi.fn(async () => null),
	setDefaultCalendar: vi.fn(async () => null),
	updateCalendar: vi.fn(async () => null),
	updateEvent: vi.fn(async () => null),
	...overrides,
});

const eventDetails: CalendarEventDetailsInput = {
	calendarId: "calendar-id",
	guests: [],
	time: {
		kind: "timed",
		endAt: "2026-07-27T11:00:00.000Z",
		startAt: "2026-07-27T10:00:00.000Z",
	},
	title: "Planning",
};

const updateDetails: UpdateCalendarEventInput = {
	calendarId: "calendar-id",
	destinationCalendarId: "calendar-id",
	guests: [],
	providerEventId: "event-id",
	time: eventDetails.time,
	title: "Updated planning",
};

describe("calendar provider module", () => {
	it("merges enabled providers into one complete deduplicated snapshot", async () => {
		const sharedGoogleEvent = createEvent({
			id: "shared",
			provider: "google",
			startAt: "2026-07-27T10:00:00.000Z",
		});
		const google = createProviderAdapter(
			createResult({
				events: [sharedGoogleEvent, sharedGoogleEvent],
				provider: "google",
			}),
		);
		const yandex = createProviderAdapter({
			calendars: [
				{
					canCreateEvents: true,
					canEdit: true,
					canSetDefault: true,
					color: "#10b981",
					id: "yandex-calendar",
					name: "yandex calendar",
					provider: "yandex",
					removalMode: "delete",
					requiresEventMove: true,
				},
			],
			connectedCalendarCount: 1,
			events: [
				createEvent({
					id: "shared",
					provider: "yandex",
					startAt: "2026-07-27T10:00:00.000Z",
				}),
				createEvent({
					id: "yandex-only",
					provider: "yandex",
					startAt: "2026-07-27T12:00:00.000Z",
				}),
			],
		});
		const providerModule = createCalendarProviderModule({
			adapters: { google, yandex },
		});

		const result = await providerModule.listWorkspaceEvents({
			...readInput,
			visibility: { google: true, yandex: true },
		});

		expect(google.listEvents).toHaveBeenCalledWith(readInput);
		expect(yandex.listEvents).toHaveBeenCalledWith(readInput);
		expect(result.connectedCalendarCount).toBe(2);
		expect(result.calendars.map((calendar) => calendar.id)).toEqual([
			"google-calendar",
			"yandex-calendar",
		]);
		expect(result.events.map((event) => event.id)).toEqual([
			"shared",
			"shared",
			"yandex-only",
		]);
	});

	it("does not load disabled providers", async () => {
		const google = createProviderAdapter(
			createResult({ events: [], provider: "google" }),
		);
		const yandex = createProviderAdapter(
			createResult({ events: [], provider: "yandex" }),
		);
		const providerModule = createCalendarProviderModule({
			adapters: { google, yandex },
		});

		await providerModule.listWorkspaceEvents({
			...readInput,
			visibility: { google: true, yandex: false },
		});

		expect(google.listEvents).toHaveBeenCalledOnce();
		expect(yandex.listEvents).not.toHaveBeenCalled();
	});

	it("rejects a refresh when any enabled provider fails", async () => {
		const google = createProviderAdapter(
			createResult({ events: [], provider: "google" }),
		);
		const yandex = createProviderAdapter(
			createResult({ events: [], provider: "yandex" }),
			{
				listEvents: vi.fn(async () => {
					throw new Error("Yandex unavailable");
				}),
			},
		);
		const providerModule = createCalendarProviderModule({
			adapters: { google, yandex },
		});

		await expect(
			providerModule.listWorkspaceEvents({
				...readInput,
				visibility: { google: true, yandex: true },
			}),
		).rejects.toThrow("Yandex unavailable");
	});

	it("normalizes commands and dispatches writes only to the selected provider", async () => {
		const google = createProviderAdapter(
			createResult({ events: [], provider: "google" }),
		);
		const yandex = createProviderAdapter(
			createResult({ events: [], provider: "yandex" }),
		);
		const providerModule = createCalendarProviderModule({
			adapters: { google, yandex },
		});

		await providerModule.createCalendar({
			color: " #10B981 ",
			name: " Personal ",
			provider: "yandex",
		});
		await providerModule.updateCalendar({
			calendarId: " calendar-id ",
			color: " #10B981 ",
			name: " Personal ",
			provider: "yandex",
		});
		await providerModule.removeCalendar({
			calendarId: " calendar-id ",
			destinationCalendarId: " destination-id ",
			provider: "yandex",
		});
		await providerModule.createEvent({
			...eventDetails,
			description: " Notes ",
			guests: [" Guest@EXAMPLE.COM ", "guest@example.com"],
			provider: "yandex",
		});
		await providerModule.updateEvent({
			...updateDetails,
			destinationCalendarId: " calendar-id ",
			provider: "yandex",
			providerEventId: " event-id ",
		});
		await providerModule.deleteEvent({
			calendarId: "calendar-id",
			provider: "yandex",
			providerEventId: " event-id ",
		});
		await providerModule.removeEvent({
			calendarId: "calendar-id",
			provider: "yandex",
			providerEventId: " event-id ",
		});
		await providerModule.setDefaultCalendar({
			calendarId: " calendar-id ",
			provider: "yandex",
		});

		expect(yandex.createCalendar).toHaveBeenCalledWith({
			color: "#10b981",
			name: "Personal",
		});
		expect(yandex.updateCalendar).toHaveBeenCalledWith({
			calendarId: "calendar-id",
			color: "#10b981",
			name: "Personal",
		});
		expect(yandex.removeCalendar).toHaveBeenCalledWith({
			calendarId: "calendar-id",
			destinationCalendarId: "destination-id",
		});
		expect(yandex.createEvent).toHaveBeenCalledWith({
			...eventDetails,
			description: "Notes",
			guests: ["guest@example.com"],
			location: undefined,
			recurrence: undefined,
		});
		expect(yandex.updateEvent).toHaveBeenCalledWith({
			...updateDetails,
			description: undefined,
			location: undefined,
			recurrenceId: undefined,
			recurrenceIsAllDay: undefined,
			seriesProviderEventId: undefined,
		});
		expect(yandex.deleteEvent).toHaveBeenCalledWith({
			calendarId: "calendar-id",
			providerEventId: "event-id",
		});
		expect(yandex.removeEvent).toHaveBeenCalledWith({
			calendarId: "calendar-id",
			providerEventId: "event-id",
		});
		expect(yandex.setDefaultCalendar).toHaveBeenCalledWith({
			calendarId: "calendar-id",
		});
		expect(google.createCalendar).not.toHaveBeenCalled();
		expect(google.updateCalendar).not.toHaveBeenCalled();
		expect(google.removeCalendar).not.toHaveBeenCalled();
		expect(google.createEvent).not.toHaveBeenCalled();
		expect(google.updateEvent).not.toHaveBeenCalled();
		expect(google.deleteEvent).not.toHaveBeenCalled();
		expect(google.removeEvent).not.toHaveBeenCalled();
		expect(google.setDefaultCalendar).not.toHaveBeenCalled();
	});

	it("rejects invalid commands before the provider seam", async () => {
		const google = createProviderAdapter(
			createResult({ events: [], provider: "google" }),
		);
		const yandex = createProviderAdapter(
			createResult({ events: [], provider: "yandex" }),
		);
		const providerModule = createCalendarProviderModule({
			adapters: { google, yandex },
		});

		await expect(
			providerModule.createEvent({
				...eventDetails,
				provider: "google",
				title: " ",
			}),
		).rejects.toMatchObject({
			data: { code: "CALENDAR_EVENT_TITLE_REQUIRED" },
		});
		await expect(
			providerModule.updateCalendar({
				calendarId: " ",
				color: "#10b981",
				name: "Personal",
				provider: "google",
			}),
		).rejects.toMatchObject({ data: { code: "INVALID_CALENDAR_ID" } });
		await expect(
			providerModule.deleteEvent({
				calendarId: "calendar-id",
				provider: "google",
				providerEventId: " ",
			}),
		).rejects.toMatchObject({
			data: { code: "INVALID_CALENDAR_EVENT_ID" },
		});

		expect(google.createEvent).not.toHaveBeenCalled();
		expect(google.updateCalendar).not.toHaveBeenCalled();
		expect(google.deleteEvent).not.toHaveBeenCalled();
	});
});
