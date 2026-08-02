import { describe, expect, it } from "vitest";
import {
	getCalendarWeekdayFromDateValue,
	parseCalendarRecurrence,
} from "./calendarRecurrence";

describe("calendar recurrence normalization", () => {
	it("normalizes interval and weekday rules", () => {
		expect(
			parseCalendarRecurrence({
				recurrenceLines: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"],
			}),
		).toEqual({
			frequency: "weekly",
			interval: 2,
			weekdays: ["mon", "wed"],
		});
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
			frequency: "weekly",
			interval: 1,
			weekdays: ["mon"],
		});
	});
});
