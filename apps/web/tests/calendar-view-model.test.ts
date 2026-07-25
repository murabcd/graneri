import { describe, expect, it } from "vitest";
import type { UpcomingCalendarEvent } from "../src/app/app-types";
import {
	filterCalendarEvents,
	getCalendarAgendaRange,
	toCalendarRequestWindow,
	toCalendarSources,
} from "../src/components/calendar/calendar-view-model";

const createEvent = (
	overrides: Partial<UpcomingCalendarEvent> = {},
): UpcomingCalendarEvent => ({
	id: "event-1",
	calendarId: "work",
	calendarName: "Work",
	title: "Planning",
	startAt: "2026-07-24T10:00:00.000Z",
	endAt: "2026-07-24T11:00:00.000Z",
	isAllDay: false,
	isMeeting: true,
	isRecurring: false,
	provider: "google",
	providerEventId: "provider-event-1",
	...overrides,
});

describe("calendar view model", () => {
	it("uses a 30-day agenda window starting at local midnight", () => {
		const range = getCalendarAgendaRange(
			new Date(2026, 6, 24, 18, 30, 45, 120),
		);

		expect([
			range.start.getFullYear(),
			range.start.getMonth(),
			range.start.getDate(),
			range.start.getHours(),
		]).toEqual([2026, 6, 24, 0]);
		expect([
			range.end.getFullYear(),
			range.end.getMonth(),
			range.end.getDate(),
			range.end.getHours(),
		]).toEqual([2026, 7, 23, 0]);
	});

	it("maps visible ranges to the backend request contract", () => {
		expect(
			toCalendarRequestWindow({
				start: new Date("2026-07-20T00:00:00.000Z"),
				end: new Date("2026-07-27T00:00:00.000Z"),
			}),
		).toEqual({
			timeMin: "2026-07-20T00:00:00.000Z",
			timeMax: "2026-07-27T00:00:00.000Z",
		});
	});

	it("shows events from every selected calendar", () => {
		const workEvent = createEvent();
		const personalEvent = createEvent({
			id: "event-2",
			calendarId: "personal",
			calendarName: "Personal",
		});

		expect(
			filterCalendarEvents(
				[workEvent, personalEvent],
				new Set(["work", "personal"]),
			),
		).toEqual([workEvent, personalEvent]);
		expect(
			filterCalendarEvents([workEvent, personalEvent], new Set(["personal"])),
		).toEqual([personalEvent]);
		expect(filterCalendarEvents([workEvent, personalEvent], new Set())).toEqual(
			[],
		);
	});

	it("preserves provider-owned calendar colors", () => {
		const calendars = [
			{
				canCreateEvents: true,
				color: "#3b82f6",
				id: "work",
				name: "Work",
				provider: "google" as const,
			},
			{
				canCreateEvents: true,
				color: "#10b981",
				id: "personal",
				name: "Personal",
				provider: "yandex" as const,
			},
		];

		expect(toCalendarSources(calendars)).toEqual(calendars);
	});
});
