import type { UpcomingCalendarEvent } from "@/app/app-types";

const WEEKDAY_LABELS = {
	fri: "Fri",
	mon: "Mon",
	sat: "Sat",
	sun: "Sun",
	thu: "Thu",
	tue: "Tue",
	wed: "Wed",
} as const;

const FREQUENCY_LABELS = {
	daily: { singular: "day", standard: "daily" },
	monthly: { singular: "month", standard: "monthly" },
	weekly: { singular: "week", standard: "weekly" },
	yearly: { singular: "year", standard: "yearly" },
} as const;

export const formatCalendarRecurrence = (
	recurrence: NonNullable<UpcomingCalendarEvent["recurrence"]>,
) => {
	if (recurrence.frequency === "custom") {
		return "Recurring event";
	}

	const labels = FREQUENCY_LABELS[recurrence.frequency];
	const frequency =
		recurrence.interval === 1
			? labels.standard
			: `every ${recurrence.interval} ${labels.singular}s`;
	const weekdays = recurrence.weekdays
		.map((weekday) => WEEKDAY_LABELS[weekday])
		.join(", ");

	return `Repeats ${frequency}${weekdays ? ` on ${weekdays}` : ""}`;
};
