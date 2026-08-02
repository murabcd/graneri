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

const RECURRENCE_END_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
	day: "numeric",
	month: "short",
	year: "numeric",
});

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
	const end = (() => {
		switch (recurrence.end.kind) {
			case "after_count":
				return ` for ${recurrence.end.count} occurrences`;
			case "on_date":
				return ` until ${RECURRENCE_END_DATE_FORMATTER.format(
					new Date(`${recurrence.end.date}T00:00:00`),
				)}`;
			case "never":
				return "";
		}
	})();

	return `Repeats ${frequency}${weekdays ? ` on ${weekdays}` : ""}${end}`;
};
