export type CalendarDateTimeParts = {
	day: number;
	hour: number;
	minute: number;
	month: number;
	second: number;
	year: number;
};

const calendarDateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

const getCalendarDateTimeFormatter = (timeZone: string) => {
	const existingFormatter = calendarDateTimeFormatters.get(timeZone);

	if (existingFormatter) {
		return existingFormatter;
	}

	const formatter = new Intl.DateTimeFormat("en-US", {
		day: "2-digit",
		hour: "2-digit",
		hourCycle: "h23",
		minute: "2-digit",
		month: "2-digit",
		second: "2-digit",
		timeZone,
		year: "numeric",
	});
	calendarDateTimeFormatters.set(timeZone, formatter);
	return formatter;
};

export const getCalendarDateTimePartsInTimeZone = (
	date: Date,
	timeZone: string,
): CalendarDateTimeParts => {
	const parts = getCalendarDateTimeFormatter(timeZone).formatToParts(date);
	const numericPart = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((part) => part.type === type)?.value ?? "0");

	return {
		day: numericPart("day"),
		hour: numericPart("hour"),
		minute: numericPart("minute"),
		month: numericPart("month"),
		second: numericPart("second"),
		year: numericPart("year"),
	};
};

const getTimeZoneOffsetMs = (date: Date, timeZone: string) => {
	const parts = getCalendarDateTimePartsInTimeZone(date, timeZone);
	return (
		Date.UTC(
			parts.year,
			parts.month - 1,
			parts.day,
			parts.hour,
			parts.minute,
			parts.second,
		) - date.getTime()
	);
};

export const zonedCalendarDateTimeToUtc = (
	parts: CalendarDateTimeParts,
	timeZone: string,
) => {
	const utcGuess = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
	);
	const initialOffset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
	let timestamp = utcGuess - initialOffset;
	const adjustedOffset = getTimeZoneOffsetMs(new Date(timestamp), timeZone);

	if (adjustedOffset !== initialOffset) {
		timestamp = utcGuess - adjustedOffset;
	}

	return new Date(timestamp);
};

export const getCalendarDateValueInTimeZone = (
	date: Date,
	timeZone: string,
) => {
	const parts = getCalendarDateTimePartsInTimeZone(date, timeZone);
	return `${parts.year.toString().padStart(4, "0")}-${parts.month
		.toString()
		.padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
};
