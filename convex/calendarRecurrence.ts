import type { CalendarRecurrence, CalendarWeekday } from "./calendarTypes";

const CALENDAR_WEEKDAYS = [
	"sun",
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
] as const satisfies readonly CalendarWeekday[];

const WEEKDAY_BY_ICS_CODE: Record<string, CalendarWeekday> = {
	FR: "fri",
	MO: "mon",
	SA: "sat",
	SU: "sun",
	TH: "thu",
	TU: "tue",
	WE: "wed",
};

const getKnownFrequency = (
	value: string | undefined,
): Exclude<CalendarRecurrence["frequency"], "custom"> | undefined => {
	switch (value) {
		case "daily":
		case "weekly":
		case "monthly":
		case "yearly":
			return value;
		default:
			return undefined;
	}
};

export const getCalendarWeekdayByIndex = (
	weekdayIndex: number,
): CalendarWeekday | undefined => CALENDAR_WEEKDAYS[weekdayIndex];

export const getCalendarWeekdayFromDateValue = (
	value: string | undefined,
): CalendarWeekday | undefined => {
	const dateMatch = value?.match(/^(\d{4})-(\d{2})-(\d{2})/u);

	if (!dateMatch) {
		return undefined;
	}

	const date = new Date(
		Date.UTC(
			Number(dateMatch[1]),
			Number(dateMatch[2]) - 1,
			Number(dateMatch[3]),
		),
	);

	return getCalendarWeekdayByIndex(date.getUTCDay());
};

const parsePositiveInteger = (value: string | undefined) => {
	const parsed = Number(value ?? "1");
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
};

export const parseCalendarRecurrence = ({
	defaultWeekday,
	recurrenceLines,
}: {
	defaultWeekday?: CalendarWeekday;
	recurrenceLines: readonly string[];
}): CalendarRecurrence | undefined => {
	const recurrenceLine = recurrenceLines.find((line) =>
		line.trim().toUpperCase().startsWith("RRULE:"),
	);
	const rawRule = recurrenceLine
		? recurrenceLine.slice(recurrenceLine.indexOf(":") + 1)
		: recurrenceLines[0];

	if (!rawRule?.trim()) {
		return undefined;
	}

	const values = Object.fromEntries(
		rawRule
			.split(";")
			.map((entry) => entry.split("="))
			.filter((entry) => entry.length === 2)
			.map(([key, value]) => [key.toUpperCase(), value]),
	);
	const normalizedFrequency = values.FREQ?.toLowerCase();
	const frequency = getKnownFrequency(normalizedFrequency) ?? "custom";
	const weekdays =
		frequency === "weekly"
			? (values.BYDAY ?? "").split(",").flatMap((entry) => {
					const match = entry
						.trim()
						.toUpperCase()
						.match(/(MO|TU|WE|TH|FR|SA|SU)$/u);
					const weekday = match?.[1]
						? WEEKDAY_BY_ICS_CODE[match[1]]
						: undefined;
					return weekday ? [weekday] : [];
				})
			: [];

	if (frequency === "weekly" && weekdays.length === 0 && defaultWeekday) {
		weekdays.push(defaultWeekday);
	}

	return {
		frequency,
		interval: parsePositiveInteger(values.INTERVAL),
		weekdays: [...new Set(weekdays)],
	};
};
