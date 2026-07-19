import {
	type AutomationSchedule,
	type AutomationScheduleKind,
	getAutomationScheduleKind,
	getAutomationScheduleStartAt,
} from "@workspace/ai/automation-schedule";
import { AUTOMATION_SCHEDULE_PERIODS } from "./automation-types";

const scheduleLabelsByValue = Object.fromEntries(
	AUTOMATION_SCHEDULE_PERIODS.map((period) => [period.value, period.label]),
) as Record<Exclude<AutomationScheduleKind, "monthly">, string>;

const dateFormattersByTimezone = new Map<string, Intl.DateTimeFormat>();
const timeFormattersByTimezone = new Map<string, Intl.DateTimeFormat>();

const getDateFormatter = (timezone: string) => {
	const existing = dateFormattersByTimezone.get(timezone);
	if (existing) {
		return existing;
	}
	const formatter = Intl.DateTimeFormat(undefined, {
		day: "numeric",
		month: "short",
		timeZone: timezone,
		year: "numeric",
	});
	dateFormattersByTimezone.set(timezone, formatter);
	return formatter;
};

const getTimeFormatter = (timezone: string) => {
	const existing = timeFormattersByTimezone.get(timezone);
	if (existing) {
		return existing;
	}
	const formatter = Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
		timeZone: timezone,
	});
	timeFormattersByTimezone.set(timezone, formatter);
	return formatter;
};

export function getAutomationSchedulePeriodLabel({
	schedule,
}: {
	schedule: AutomationSchedule;
}) {
	const kind = getAutomationScheduleKind(schedule);
	const label = kind === "monthly" ? "Monthly" : scheduleLabelsByValue[kind];
	const startAt = getAutomationScheduleStartAt(schedule);
	const timezone = schedule.timezone;
	const time = getTimeFormatter(timezone).format(startAt);

	if (kind === "once") {
		const date = getDateFormatter(timezone).format(startAt);
		return `${label} on ${date} at ${time}`;
	}
	if (kind === "custom") {
		return label;
	}

	return `${label} at ${time}`;
}
