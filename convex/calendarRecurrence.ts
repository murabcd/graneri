import { ConvexError } from "convex/values";
import { isValidCalendarDateParts } from "./calendarDate";
import {
	getCalendarDateValueInTimeZone,
	zonedCalendarDateTimeToUtc,
} from "./calendarTimeZone";
import type {
	CalendarEventRecurrenceInput,
	CalendarEventTime,
	CalendarRecurrence,
	CalendarRecurrenceEnd,
	CalendarWeekday,
} from "./calendarTypes";

const CALENDAR_WEEKDAYS = [
	"sun",
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
] as const satisfies readonly CalendarWeekday[];

const NORMALIZED_CALENDAR_WEEKDAYS = [
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
	"sun",
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

const ICS_CODE_BY_WEEKDAY: Record<CalendarWeekday, string> = {
	fri: "FR",
	mon: "MO",
	sat: "SA",
	sun: "SU",
	thu: "TH",
	tue: "TU",
	wed: "WE",
};

const formatIcsDate = (value: string) => value.replaceAll("-", "");

const formatIcsDateTime = (value: Date) =>
	value
		.toISOString()
		.replaceAll("-", "")
		.replaceAll(":", "")
		.replace(/\.\d{3}Z$/u, "Z");

export const formatCalendarRecurrenceRule = ({
	isAllDay,
	recurrence,
}: {
	isAllDay: boolean;
	recurrence: CalendarEventRecurrenceInput;
}) => {
	const parts = [
		`FREQ=${recurrence.frequency.toUpperCase()}`,
		`INTERVAL=${recurrence.interval}`,
	];

	if (recurrence.frequency === "weekly") {
		parts.push(
			`BYDAY=${recurrence.weekdays.map((day) => ICS_CODE_BY_WEEKDAY[day]).join(",")}`,
		);
	}

	if (recurrence.end.kind === "on_date") {
		if (isAllDay) {
			parts.push(`UNTIL=${formatIcsDate(recurrence.end.date)}`);
		} else {
			const [year, month, day] = recurrence.end.date.split("-").map(Number);
			const until = zonedCalendarDateTimeToUtc(
				{ day, hour: 23, minute: 59, month, second: 59, year },
				recurrence.timeZone,
			);
			parts.push(`UNTIL=${formatIcsDateTime(until)}`);
		}
	}

	return `RRULE:${parts.join(";")}`;
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

	if (
		!dateMatch ||
		!isValidCalendarDateParts(
			Number(dateMatch[1]),
			Number(dateMatch[2]),
			Number(dateMatch[3]),
		)
	) {
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

const parseOptionalPositiveInteger = (value: string | undefined) => {
	if (!value) {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const formatDateParts = (year: number, month: number, day: number) =>
	`${year.toString().padStart(4, "0")}-${month
		.toString()
		.padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

export const normalizeCalendarEventRecurrenceInput = ({
	recurrence,
	time,
}: {
	recurrence: CalendarEventRecurrenceInput;
	time: CalendarEventTime;
}): CalendarEventRecurrenceInput => {
	let timeZone: string;

	try {
		timeZone = new Intl.DateTimeFormat("en-US", {
			timeZone: recurrence.timeZone.trim(),
		}).resolvedOptions().timeZone;
	} catch {
		throw new ConvexError({
			code: "INVALID_CALENDAR_EVENT_TIME_ZONE",
			message: "Event time zone is invalid.",
		});
	}

	if (
		!Number.isSafeInteger(recurrence.interval) ||
		recurrence.interval < 1 ||
		recurrence.interval > 999
	) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_EVENT_RECURRENCE",
			message: "Repeat interval must be between 1 and 999.",
		});
	}

	const weekdaySet = new Set(recurrence.weekdays);
	const weekdays = NORMALIZED_CALENDAR_WEEKDAYS.filter((weekday) =>
		weekdaySet.has(weekday),
	);

	if (recurrence.frequency === "weekly" && weekdays.length === 0) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_EVENT_RECURRENCE",
			message: "Select at least one weekday for a weekly event.",
		});
	}

	if (recurrence.end.kind === "on_date") {
		const dateMatch = recurrence.end.date.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
		const year = Number(dateMatch?.[1]);
		const month = Number(dateMatch?.[2]);
		const day = Number(dateMatch?.[3]);
		const startDate =
			time.kind === "all_day"
				? time.startDate
				: getCalendarDateValueInTimeZone(new Date(time.startAt), timeZone);

		if (
			!dateMatch ||
			!isValidCalendarDateParts(year, month, day) ||
			recurrence.end.date < startDate
		) {
			throw new ConvexError({
				code: "INVALID_CALENDAR_EVENT_RECURRENCE",
				message: "Repeat end date must be on or after the event date.",
			});
		}
	}

	return {
		...recurrence,
		timeZone,
		weekdays: recurrence.frequency === "weekly" ? weekdays : [],
	};
};

const parseUntilDate = (value: string | undefined, timeZone?: string) => {
	const match = value?.match(
		/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/u,
	);

	if (!match) {
		return undefined;
	}

	const [, rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond, utc] =
		match;
	const year = Number(rawYear);
	const month = Number(rawMonth);
	const day = Number(rawDay);

	if (!isValidCalendarDateParts(year, month, day)) {
		return undefined;
	}

	if (!rawHour || !rawMinute || !rawSecond || !utc || !timeZone) {
		return formatDateParts(year, month, day);
	}

	const date = new Date(
		Date.UTC(
			year,
			month - 1,
			day,
			Number(rawHour),
			Number(rawMinute),
			Number(rawSecond),
		),
	);

	return getCalendarDateValueInTimeZone(date, timeZone);
};

const parseRecurrenceEnd = (
	values: Record<string, string>,
	timeZone?: string,
): CalendarRecurrenceEnd => {
	const count = parseOptionalPositiveInteger(values.COUNT);

	if (count) {
		return { count, kind: "after_count" };
	}

	const date = parseUntilDate(values.UNTIL, timeZone);
	return date ? { date, kind: "on_date" } : { kind: "never" };
};

export const parseCalendarRecurrence = ({
	defaultWeekday,
	recurrenceLines,
	timeZone,
}: {
	defaultWeekday?: CalendarWeekday;
	recurrenceLines: readonly string[];
	timeZone?: string;
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
		end: parseRecurrenceEnd(values, timeZone),
		frequency,
		interval: parsePositiveInteger(values.INTERVAL),
		weekdays: [...new Set(weekdays)],
	};
};
