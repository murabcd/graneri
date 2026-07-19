import { describe, expect, it } from "vitest";
import {
	createAutomationScheduleDraft,
	createAutomationScheduleFromDraft,
	createDefaultAutomationScheduleDraft,
	getAutomationScheduleDraftLabel,
	setAutomationScheduleMonthDay,
	updateAutomationScheduleDraft,
} from "@/components/automations/automation-schedule-draft";

describe("automation schedule draft", () => {
	it("creates a local 9 AM default today or tomorrow", () => {
		expect(
			createDefaultAutomationScheduleDraft({
				now: new Date(2026, 6, 20, 8),
				timezone: "Europe/Moscow",
			}),
		).toMatchObject({
			period: "daily",
			date: "2026-07-20",
			time: "09:00",
			timezone: "Europe/Moscow",
			weekdays: [1],
			customFrequency: "daily",
			customInterval: 1,
		});
		expect(
			createDefaultAutomationScheduleDraft({
				now: new Date(2026, 6, 20, 9),
				timezone: "Europe/Moscow",
			}).date,
		).toBe("2026-07-21");
	});

	it("decodes persisted monthly schedules into the custom editor", () => {
		expect(
			createAutomationScheduleDraft({
				kind: "recurring",
				rrule: "FREQ=MONTHLY;BYMONTHDAY=20",
				startsAt: "2026-07-20T09:30:00",
				timezone: "Europe/Moscow",
			}),
		).toEqual({
			period: "custom",
			date: "2026-07-20",
			time: "09:30",
			timezone: "Europe/Moscow",
			weekdays: [],
			customFrequency: "monthly",
			customInterval: 1,
		});
	});

	it("normalizes interval and weekday transitions", () => {
		const draft = createDefaultAutomationScheduleDraft({
			now: new Date(2026, 6, 20, 8),
			timezone: "UTC",
		});
		const weekly = updateAutomationScheduleDraft(
			{ ...draft, weekdays: [] },
			{ period: "weekly", customInterval: 120 },
		);
		expect(weekly.weekdays).toEqual([1]);
		expect(weekly.customInterval).toBe(99);

		const customWeekly = updateAutomationScheduleDraft(
			{ ...draft, period: "custom", weekdays: [] },
			{ customFrequency: "weekly", customInterval: Number.NaN },
		);
		expect(customWeekly.weekdays).toEqual([1]);
		expect(customWeekly.customInterval).toBe(1);
	});

	it("keeps monthly dates valid and encodes the edited recurrence", () => {
		const draft = createDefaultAutomationScheduleDraft({
			now: new Date(2026, 1, 10, 8),
			timezone: "UTC",
		});
		expect(setAutomationScheduleMonthDay(draft, 31).date).toBe("2026-02-28");

		const schedule = createAutomationScheduleFromDraft({
			...draft,
			period: "custom",
			date: "2026-07-20",
			customFrequency: "weekly",
			customInterval: 2,
			weekdays: [1, 3],
		});
		expect(schedule).toEqual({
			kind: "recurring",
			rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE",
			startsAt: "2026-07-20T09:00:00",
			timezone: "UTC",
		});
	});

	it("derives the visible picker label from the durable schedule", () => {
		const draft = createDefaultAutomationScheduleDraft({
			now: new Date(2026, 6, 20, 8),
			timezone: "UTC",
		});
		expect(getAutomationScheduleDraftLabel(draft)).toMatch(/^Daily at /);
		expect(getAutomationScheduleDraftLabel({ ...draft, time: "invalid" })).toBe(
			"Daily",
		);
	});
});
