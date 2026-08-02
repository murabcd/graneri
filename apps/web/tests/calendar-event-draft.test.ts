import { describe, expect, it } from "vitest";
import {
	type CalendarEventDraft,
	createCalendarEventDraftFromEvent,
	fromDateInputValue,
	toCalendarEventCreation,
} from "../src/components/calendar/calendar-event-draft";

const draft: CalendarEventDraft = {
	allDay: false,
	calendarId: "work",
	description: "Agenda",
	endDate: "2026-07-27",
	endTime: "11:00",
	guests: ["one@example.com", "two@example.com"],
	location: "Room 1",
	recurrence: {
		enabled: false,
		endDate: "2026-08-24",
		endMode: "never",
		frequency: "weekly",
		interval: 1,
		weekdays: ["mon"],
	},
	startDate: "2026-07-27",
	startTime: "10:00",
	title: "Product sync",
};

describe("calendar event draft", () => {
	it("rejects invalid date input values instead of normalizing them", () => {
		expect(fromDateInputValue("2026-02-29")).toBeUndefined();
		expect(fromDateInputValue("2028-02-29")).toEqual(new Date(2028, 1, 29));
	});

	it("converts local event times to instants", () => {
		const result = toCalendarEventCreation(draft, "google");

		expect(result).toMatchObject({
			calendarId: "work",
			guests: ["one@example.com", "two@example.com"],
			provider: "google",
			title: "Product sync",
			time: {
				kind: "timed",
			},
		});
		expect(result.time.kind).toBe("timed");

		if (result.time.kind === "timed") {
			expect(new Date(result.time.startAt).getTime()).toBe(
				new Date("2026-07-27T10:00:00").getTime(),
			);
			expect(new Date(result.time.endAt).getTime()).toBe(
				new Date("2026-07-27T11:00:00").getTime(),
			);
		}
	});

	it("uses an exclusive end date for all-day events", () => {
		expect(
			toCalendarEventCreation(
				{
					...draft,
					allDay: true,
					startDate: "2026-07-27",
					endDate: "2026-07-28",
				},
				"yandex",
			).time,
		).toEqual({
			kind: "all_day",
			startDate: "2026-07-27",
			endDate: "2026-07-29",
		});
	});

	it("adds a complete provider recurrence with the local time zone", () => {
		const result = toCalendarEventCreation(
			{
				...draft,
				recurrence: {
					...draft.recurrence,
					enabled: true,
					endDate: "2026-08-31",
					endMode: "on_date",
					frequency: "weekly",
					interval: 2,
					weekdays: ["mon", "wed"],
				},
			},
			"google",
		);

		expect(result.recurrence).toEqual({
			end: { date: "2026-08-31", kind: "on_date" },
			frequency: "weekly",
			interval: 2,
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			weekdays: ["mon", "wed"],
		});
	});

	it("rejects a repeat end date before the event", () => {
		expect(() =>
			toCalendarEventCreation(
				{
					...draft,
					recurrence: {
						...draft.recurrence,
						enabled: true,
						endDate: "2026-07-26",
						endMode: "on_date",
					},
				},
				"google",
			),
		).toThrow("Repeat end date must be on or after the event date.");
	});

	it("keeps provider all-day UTC dates stable in the local editor", () => {
		const eventDraft = createCalendarEventDraftFromEvent({
			attendees: [],
			canDelete: true,
			canEdit: true,
			guestPermissions: "manage",
			calendarId: "work",
			calendarName: "Work",
			endAt: "2026-08-02T23:59:59.999Z",
			id: "all-day-event-1",
			isAllDay: true,
			isMeeting: false,
			isRecurring: false,
			provider: "yandex",
			providerEventId: "provider-all-day-event-1",
			startAt: "2026-08-02T00:00:00.000Z",
			title: "All-day check",
		});

		expect(eventDraft.startDate).toBe("2026-08-02");
		expect(eventDraft.endDate).toBe("2026-08-02");
		expect(toCalendarEventCreation(eventDraft, "yandex").time).toEqual({
			kind: "all_day",
			startDate: "2026-08-02",
			endDate: "2026-08-03",
		});
	});

	it("rejects an end time before the start time", () => {
		expect(() =>
			toCalendarEventCreation(
				{
					...draft,
					endTime: "09:00",
				},
				"google",
			),
		).toThrow("Select a valid event time range.");
	});

	it("prefills editable guests without duplicating the organizer or self", () => {
		const eventDraft = createCalendarEventDraftFromEvent({
			attendees: [
				{
					email: "owner@example.com",
					isOrganizer: true,
					isSelf: true,
					responseStatus: "accepted",
				},
				{
					email: "guest@example.com",
					isOrganizer: false,
					isSelf: false,
					responseStatus: "tentative",
				},
			],
			canDelete: true,
			canEdit: true,
			guestPermissions: "manage",
			calendarId: "work",
			calendarName: "Work",
			endAt: "2026-07-27T11:00:00.000Z",
			id: "event-1",
			isAllDay: false,
			isMeeting: true,
			isRecurring: false,
			provider: "google",
			providerEventId: "provider-event-1",
			startAt: "2026-07-27T10:00:00.000Z",
			title: "Product sync",
		});

		expect(eventDraft.guests).toEqual(["guest@example.com"]);
	});
});
