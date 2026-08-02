import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import {
	formatCalendarRecurrenceRule,
	getCalendarWeekdayFromDateValue,
	normalizeCalendarEventRecurrenceInput,
	parseCalendarRecurrence,
} from "./calendarRecurrence";

describe("calendar recurrence normalization", () => {
	it("formats interval and weekdays without an end date", () => {
		expect(
			formatCalendarRecurrenceRule({
				isAllDay: false,
				recurrence: {
					end: { kind: "never" },
					frequency: "weekly",
					interval: 2,
					timeZone: "Europe/Moscow",
					weekdays: ["mon", "wed"],
				},
			}),
		).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE");
	});

	it("formats inclusive end dates for timed and all-day events", () => {
		const recurrence = {
			end: { date: "2026-08-31", kind: "on_date" as const },
			frequency: "daily" as const,
			interval: 1,
			timeZone: "Europe/Moscow",
			weekdays: [],
		};

		expect(formatCalendarRecurrenceRule({ isAllDay: false, recurrence })).toBe(
			"RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20260831T205959Z",
		);
		expect(formatCalendarRecurrenceRule({ isAllDay: true, recurrence })).toBe(
			"RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20260831",
		);
	});

	it("normalizes interval and weekday rules", () => {
		expect(
			parseCalendarRecurrence({
				recurrenceLines: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"],
			}),
		).toEqual({
			end: { kind: "never" },
			frequency: "weekly",
			interval: 2,
			weekdays: ["mon", "wed"],
		});
	});

	it("canonicalizes creation input at the recurrence boundary", () => {
		expect(
			normalizeCalendarEventRecurrenceInput({
				recurrence: {
					end: { date: "2026-08-31", kind: "on_date" },
					frequency: "weekly",
					interval: 2,
					timeZone: " Europe/Moscow ",
					weekdays: ["wed", "mon", "wed"],
				},
				time: {
					endAt: "2026-08-03T08:00:00.000Z",
					kind: "timed",
					startAt: "2026-08-03T07:00:00.000Z",
				},
			}),
		).toEqual({
			end: { date: "2026-08-31", kind: "on_date" },
			frequency: "weekly",
			interval: 2,
			timeZone: "Europe/Moscow",
			weekdays: ["mon", "wed"],
		});
	});

	it("rejects invalid creation recurrence at the shared boundary", () => {
		expect(() =>
			normalizeCalendarEventRecurrenceInput({
				recurrence: {
					end: { kind: "never" },
					frequency: "weekly",
					interval: 1,
					timeZone: "Europe/Moscow",
					weekdays: [],
				},
				time: {
					endDate: "2026-08-04",
					kind: "all_day",
					startDate: "2026-08-03",
				},
			}),
		).toThrow(ConvexError);
	});

	it("uses the local date portion when a weekly rule omits BYDAY", () => {
		expect(
			parseCalendarRecurrence({
				defaultWeekday: getCalendarWeekdayFromDateValue(
					"2026-08-03T23:30:00-07:00",
				),
				recurrenceLines: ["FREQ=WEEKLY"],
			}),
		).toEqual({
			end: { kind: "never" },
			frequency: "weekly",
			interval: 1,
			weekdays: ["mon"],
		});
	});

	it("normalizes count and zoned UTC end conditions", () => {
		expect(
			parseCalendarRecurrence({
				recurrenceLines: ["RRULE:FREQ=DAILY;COUNT=8"],
			}),
		).toMatchObject({ end: { count: 8, kind: "after_count" } });

		expect(
			parseCalendarRecurrence({
				recurrenceLines: ["RRULE:FREQ=DAILY;UNTIL=20260831T205959Z"],
				timeZone: "Europe/Moscow",
			}),
		).toMatchObject({ end: { date: "2026-08-31", kind: "on_date" } });
	});
});
