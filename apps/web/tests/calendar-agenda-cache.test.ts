import { beforeEach, describe, expect, it } from "vitest";
import type { UpcomingCalendarEvent } from "../src/app/app-types";
import {
	readCalendarAgendaSnapshot,
	writeCalendarAgendaSnapshot,
} from "../src/components/calendar/calendar-agenda-cache";
import type { CalendarSource } from "../src/components/calendar/calendar-view-model";

const requestWindow = {
	timeMin: "2026-07-25T00:00:00.000Z",
	timeMax: "2026-08-24T00:00:00.000Z",
};

const calendars: CalendarSource[] = [
	{
		canCreateEvents: true,
		id: "work",
		name: "Work",
		color: "var(--color-blue-500)",
		provider: "google",
	},
];

const events: UpcomingCalendarEvent[] = [
	{
		id: "event-1",
		calendarId: "work",
		calendarName: "Work",
		title: "Planning",
		startAt: "2026-07-27T10:00:00.000Z",
		endAt: "2026-07-27T11:00:00.000Z",
		isAllDay: false,
		isMeeting: true,
		isRecurring: false,
		provider: "google",
		providerEventId: "provider-event-1",
	},
];

describe("calendar agenda cache", () => {
	beforeEach(() => {
		window.sessionStorage.clear();
	});

	it("does not restore snapshots from the obsolete cache schema", () => {
		const key = `workspace-legacy:${requestWindow.timeMin}:${requestWindow.timeMax}`;
		window.sessionStorage.setItem(
			"graneri:calendar-agenda-cache:v1",
			JSON.stringify({
				version: 1,
				agendas: [
					{
						cachedAt: Date.now(),
						key,
						calendars: [
							...calendars,
							{
								canCreateEvents: false,
								id: "yandex:/calendars/owner/todos-1/",
								name: "Reminders",
								color: "var(--color-rose-500)",
								provider: "yandex",
							},
						],
						events,
					},
				],
			}),
		);

		expect(
			readCalendarAgendaSnapshot("workspace-legacy", requestWindow),
		).toBeNull();
	});

	it("persists an agenda snapshot with the current schema", () => {
		writeCalendarAgendaSnapshot("workspace-refresh", requestWindow, {
			calendars,
			events,
		});

		expect(
			window.sessionStorage.getItem("graneri:calendar-agenda-cache:v6"),
		).toContain('"version":6');
		expect(
			readCalendarAgendaSnapshot("workspace-refresh", requestWindow),
		).toEqual({ calendars, events });
		expect(window.sessionStorage.length).toBe(1);
	});

	it("does not reuse an agenda for a different date window", () => {
		writeCalendarAgendaSnapshot("workspace-window", requestWindow, {
			calendars,
			events,
		});

		expect(
			readCalendarAgendaSnapshot("workspace-window", {
				timeMin: "2026-08-24T00:00:00.000Z",
				timeMax: "2026-09-23T00:00:00.000Z",
			}),
		).toBeNull();
	});
});
