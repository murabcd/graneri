import { describe, expect, it } from "vitest";
import {
	createSimpleAutomationSchedule,
	getAutomationScheduleKind,
	getNextAutomationRunAt,
	normalizeAutomationSchedule,
} from "../src/automation-schedule.mjs";

describe("automation schedule", () => {
	it("runs a one-time task only once", () => {
		const schedule = {
			kind: "once" as const,
			at: Date.parse("2026-08-01T12:00:00Z"),
			timezone: "Europe/London",
		};

		expect(
			getNextAutomationRunAt({
				from: Date.parse("2026-08-01T11:00:00Z"),
				schedule,
			}),
		).toBe(Date.parse("2026-08-01T12:00:00Z"));
		expect(
			getNextAutomationRunAt({
				from: Date.parse("2026-08-01T12:00:00Z"),
				schedule,
			}),
		).toBeNull();
	});

	it("keeps a daily task at the same London wall-clock time across DST", () => {
		const schedule = normalizeAutomationSchedule({
			kind: "recurring",
			rrule: "RRULE:FREQ=DAILY",
			startsAt: "2026-03-01T09:00:00",
			timezone: "Europe/London",
		});

		expect(
			getNextAutomationRunAt({
				from: Date.parse("2026-03-20T12:00:00Z"),
				schedule,
			}),
		).toBe(Date.parse("2026-03-21T09:00:00Z"));
		expect(
			getNextAutomationRunAt({
				from: Date.parse("2026-03-30T00:00:00Z"),
				schedule,
			}),
		).toBe(Date.parse("2026-03-30T08:00:00Z"));
	});

	it("supports multiple weekly days", () => {
		const schedule = normalizeAutomationSchedule({
			kind: "recurring",
			rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
			startsAt: "2026-07-20T10:30:00",
			timezone: "Europe/Moscow",
		});

		expect(
			getNextAutomationRunAt({
				from: Date.parse("2026-07-21T12:00:00Z"),
				schedule,
			}),
		).toBe(Date.parse("2026-07-22T07:30:00Z"));
	});

	it("recognizes simple schedules", () => {
		const schedule = createSimpleAutomationSchedule({
			frequency: "weekdays",
			scheduledAt: Date.parse("2026-07-20T06:00:00Z"),
			timezone: "Europe/Moscow",
		});

		expect(getAutomationScheduleKind(schedule)).toBe("weekdays");
	});

	it("rejects schedules that run more than once per hour", () => {
		expect(() =>
			normalizeAutomationSchedule({
				kind: "recurring",
				rrule: "FREQ=MINUTELY;INTERVAL=15",
				startsAt: "2026-07-20T10:30:00",
				timezone: "Europe/Moscow",
			}),
		).toThrow("cannot run more than once per hour");
		expect(() =>
			normalizeAutomationSchedule({
				kind: "recurring",
				rrule: "FREQ=HOURLY;BYMINUTE=0,30",
				startsAt: "2026-07-20T10:00:00",
				timezone: "Europe/Moscow",
			}),
		).toThrow("cannot run more than once per hour");
	});

	it("rejects invalid timezones and recurrence rules", () => {
		expect(() =>
			normalizeAutomationSchedule({
				kind: "recurring",
				rrule: "FREQ=DAILY",
				startsAt: "2026-07-20T10:30:00",
				timezone: "Not/A_Timezone",
			}),
		).toThrow("valid IANA timezone");
		expect(() =>
			normalizeAutomationSchedule({
				kind: "recurring",
				rrule: "NOPE",
				startsAt: "2026-07-20T10:30:00",
				timezone: "UTC",
			}),
		).toThrow("recurrence rule is invalid");
	});
});
