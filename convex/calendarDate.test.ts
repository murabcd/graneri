import { describe, expect, it } from "vitest";
import { isCalendarDateValue, isValidCalendarDateParts } from "./calendarDate";

describe("calendar date validation", () => {
	it("accepts real calendar dates including leap days", () => {
		expect(isCalendarDateValue("2028-02-29")).toBe(true);
		expect(isValidCalendarDateParts(2026, 8, 2)).toBe(true);
	});

	it("rejects normalized, partial, and malformed dates", () => {
		for (const value of [
			"2026-02-29",
			"2026-04-31",
			"2026-13-01",
			"2026-08-2",
			"2026-08-02T00:00:00Z",
		]) {
			expect(isCalendarDateValue(value)).toBe(false);
		}
	});
});
