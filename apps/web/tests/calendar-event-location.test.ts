import { describe, expect, it } from "vitest";
import { formatCalendarEventLocation } from "../src/components/calendar/calendar-event-location";

describe("calendar event location", () => {
	it.each([
		"https://telemost.yandex.ru/j/3547827652",
		"https://telemost.360.yandex.ru/j/3547827652",
	])("labels Yandex Telemost links", (location) => {
		expect(formatCalendarEventLocation(location)).toBe("Yandex Telemost");
	});

	it("preserves other URLs and free-form locations", () => {
		expect(
			formatCalendarEventLocation(
				"https://teams.microsoft.com/l/meetup-join/example",
			),
		).toBe("https://teams.microsoft.com/l/meetup-join/example");
		expect(formatCalendarEventLocation("Microsoft Teams Meeting")).toBe(
			"Microsoft Teams Meeting",
		);
	});
});
