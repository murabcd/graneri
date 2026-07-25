import { describe, expect, it } from "vitest";
import {
	type CalendarEventDraft,
	toCalendarEventCreation,
} from "../src/components/calendar/calendar-event-draft";

const draft: CalendarEventDraft = {
	allDay: false,
	calendarId: "work",
	description: "Agenda",
	endDate: "2026-07-27",
	endTime: "11:00",
	guests: "one@example.com, two@example.com",
	location: "Room 1",
	startDate: "2026-07-27",
	startTime: "10:00",
	title: "Product sync",
};

describe("calendar event draft", () => {
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
});
