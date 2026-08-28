import { describe, expect, it } from "vitest";
import { classifyCalendarReadError } from "./calendarReadError";

describe("classifyCalendarReadError", () => {
	it("classifies the Node fetch failure emitted by unavailable providers", () => {
		expect(classifyCalendarReadError(new TypeError("fetch failed"))).toBe(
			"unavailable",
		);
	});

	it("classifies provider authentication failures as disconnected", () => {
		const error = Object.assign(new Error("Unauthorized"), { status: 401 });

		expect(classifyCalendarReadError(error)).toBe("not_connected");
	});

	it("does not hide unrelated provider or programming failures", () => {
		expect(classifyCalendarReadError(new Error("fetch failed"))).toBeNull();
		expect(classifyCalendarReadError(new TypeError("Invalid URL"))).toBeNull();
		expect(
			classifyCalendarReadError(
				Object.assign(new Error("Provider failure"), { status: 500 }),
			),
		).toBeNull();
	});
});
