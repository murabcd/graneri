import {
	type AutomationSchedule,
	createAutomationScheduleFromLocal,
	normalizeAutomationSchedule,
} from "@workspace/ai/automation-schedule";
import type { AutomationSchedulePeriod } from "./automation-types";

export type AutomationScheduleFormValue = {
	schedulePeriod: AutomationSchedulePeriod;
	scheduleDate: string;
	scheduleTime: string;
	scheduleTimezone: string;
	scheduleWeekdays: number[];
	customRrule: string;
};

export const createInitialScheduleLocalStart = () => {
	const nextDate = new Date();
	if (nextDate.getHours() >= 9) {
		nextDate.setDate(nextDate.getDate() + 1);
	}
	nextDate.setHours(9, 0, 0, 0);
	const year = nextDate.getFullYear();
	const month = String(nextDate.getMonth() + 1).padStart(2, "0");
	const day = String(nextDate.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}T09:00:00`;
};

export const getCurrentTimezone = () =>
	Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export const getLocalDateIsoWeekday = (date: string) => {
	const day = new Date(`${date}T12:00:00`).getDay();
	return day === 0 ? 7 : day;
};

export const createScheduleFromFormValue = ({
	schedulePeriod,
	scheduleDate,
	scheduleTime,
	scheduleTimezone,
	scheduleWeekdays,
	customRrule,
}: AutomationScheduleFormValue): AutomationSchedule => {
	const startsAt = `${scheduleDate}T${scheduleTime}:00`;
	if (schedulePeriod === "custom") {
		return normalizeAutomationSchedule({
			kind: "recurring",
			rrule: customRrule,
			startsAt,
			timezone: scheduleTimezone,
		});
	}

	return createAutomationScheduleFromLocal({
		frequency: schedulePeriod,
		startsAt,
		timezone: scheduleTimezone,
		weekdays: scheduleWeekdays,
	});
};
