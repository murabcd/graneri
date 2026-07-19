import {
	type AutomationCustomFrequency,
	type AutomationSchedule,
	createAutomationScheduleFromLocal,
	createCustomAutomationScheduleFromLocal,
	getAutomationCustomRecurrence,
	getAutomationScheduleKind,
	getAutomationScheduleLocalStart,
	getAutomationScheduleWeekdays,
} from "@workspace/ai/automation-schedule";
import type { AutomationSchedulePeriod } from "./automation-types";
import { getAutomationSchedulePeriodLabel } from "./automation-utils";

export type AutomationScheduleDraft = {
	period: AutomationSchedulePeriod;
	date: string;
	time: string;
	timezone: string;
	weekdays: number[];
	customFrequency: AutomationCustomFrequency;
	customInterval: number;
};

const getCurrentTimezone = () =>
	Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const getLocalDateIsoWeekday = (date: string) => {
	const day = new Date(`${date}T12:00:00`).getDay();
	return day === 0 ? 7 : day;
};

const createInitialScheduleLocalStart = (now: Date) => {
	const nextDate = new Date(now);
	if (nextDate.getHours() >= 9) {
		nextDate.setDate(nextDate.getDate() + 1);
	}
	nextDate.setHours(9, 0, 0, 0);
	const year = nextDate.getFullYear();
	const month = String(nextDate.getMonth() + 1).padStart(2, "0");
	const day = String(nextDate.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}T09:00:00`;
};

const normalizeWeekdays = (weekdays: number[]) =>
	[...new Set(weekdays)]
		.filter(
			(weekday) => Number.isInteger(weekday) && weekday >= 1 && weekday <= 7,
		)
		.sort((left, right) => left - right);

const normalizeCustomInterval = (interval: number) =>
	Number.isFinite(interval)
		? Math.max(1, Math.min(99, Math.trunc(interval)))
		: 1;

export const createDefaultAutomationScheduleDraft = ({
	now = new Date(),
	timezone = getCurrentTimezone(),
}: {
	now?: Date;
	timezone?: string;
} = {}): AutomationScheduleDraft => {
	const localStart = createInitialScheduleLocalStart(now);
	const date = localStart.slice(0, 10);
	return {
		period: "daily",
		date,
		time: localStart.slice(11, 16),
		timezone,
		weekdays: [getLocalDateIsoWeekday(date)],
		customFrequency: "daily",
		customInterval: 1,
	};
};

export const createAutomationScheduleDraft = (
	schedule: AutomationSchedule,
): AutomationScheduleDraft => {
	const localStart = getAutomationScheduleLocalStart(schedule);
	const kind = getAutomationScheduleKind(schedule);
	const customRecurrence = getAutomationCustomRecurrence(schedule);
	return {
		period: kind === "monthly" ? "custom" : kind,
		date: localStart.slice(0, 10),
		time: localStart.slice(11, 16),
		timezone: schedule.timezone,
		weekdays: getAutomationScheduleWeekdays(schedule),
		customFrequency: customRecurrence.frequency,
		customInterval: customRecurrence.interval,
	};
};

export const updateAutomationScheduleDraft = (
	draft: AutomationScheduleDraft,
	update: Partial<AutomationScheduleDraft>,
): AutomationScheduleDraft => {
	const nextDraft = {
		...draft,
		...update,
		customInterval: normalizeCustomInterval(
			update.customInterval ?? draft.customInterval,
		),
		weekdays: normalizeWeekdays(update.weekdays ?? draft.weekdays),
	};
	const needsWeekdays =
		nextDraft.period === "weekly" ||
		(nextDraft.period === "custom" && nextDraft.customFrequency === "weekly");
	return needsWeekdays && nextDraft.weekdays.length === 0
		? {
				...nextDraft,
				weekdays: [getLocalDateIsoWeekday(nextDraft.date)],
			}
		: nextDraft;
};

export const setAutomationScheduleMonthDay = (
	draft: AutomationScheduleDraft,
	day: number,
) => {
	const [year, month] = draft.date.split("-").map(Number);
	if (!year || !month) {
		return draft;
	}
	const lastDay = new Date(year, month, 0).getDate();
	const normalizedDay = Number.isFinite(day)
		? Math.min(Math.max(Math.trunc(day), 1), lastDay)
		: 1;
	const date = `${draft.date.slice(0, 8)}${String(normalizedDay).padStart(2, "0")}`;
	return updateAutomationScheduleDraft(draft, { date });
};

export const createAutomationScheduleFromDraft = ({
	period,
	date,
	time,
	timezone,
	weekdays,
	customFrequency,
	customInterval,
}: AutomationScheduleDraft): AutomationSchedule => {
	const startsAt = `${date}T${time}:00`;
	if (period === "custom") {
		return createCustomAutomationScheduleFromLocal({
			frequency: customFrequency,
			interval: customInterval,
			startsAt,
			timezone,
			weekdays,
		});
	}

	return createAutomationScheduleFromLocal({
		frequency: period,
		startsAt,
		timezone,
		weekdays,
	});
};

export const getAutomationScheduleDraftLabel = (
	draft: AutomationScheduleDraft,
) => {
	try {
		return getAutomationSchedulePeriodLabel({
			schedule: createAutomationScheduleFromDraft(draft),
		});
	} catch {
		return draft.period === "custom"
			? "Custom"
			: draft.period.charAt(0).toUpperCase() + draft.period.slice(1);
	}
};
