import { formatCalendarRecurrenceRule } from "./calendarRecurrence";
import { getCalendarDateTimePartsInTimeZone } from "./calendarTimeZone";
import type { CalendarEventDetailsInput } from "./calendarTypes";

export const formatCalDavTimestamp = (value: number) => {
	const date = new Date(value);
	const parts = [
		date.getUTCFullYear().toString().padStart(4, "0"),
		(date.getUTCMonth() + 1).toString().padStart(2, "0"),
		date.getUTCDate().toString().padStart(2, "0"),
		"T",
		date.getUTCHours().toString().padStart(2, "0"),
		date.getUTCMinutes().toString().padStart(2, "0"),
		date.getUTCSeconds().toString().padStart(2, "0"),
		"Z",
	];

	return parts.join("");
};

export const escapeIcsText = (value: string) =>
	value
		.replaceAll("\\", "\\\\")
		.replaceAll("\r\n", "\\n")
		.replaceAll("\r", "\\n")
		.replaceAll("\n", "\\n")
		.replaceAll(",", "\\,")
		.replaceAll(";", "\\;");

export const formatIcsDate = (value: string) => value.replaceAll("-", "");

export const formatIcsDateTime = (value: string) =>
	new Date(value)
		.toISOString()
		.replaceAll("-", "")
		.replaceAll(":", "")
		.replace(/\.\d{3}Z$/u, "Z");

const formatIcsZonedDateTime = (value: string, timeZone: string) => {
	const parts = getCalendarDateTimePartsInTimeZone(new Date(value), timeZone);
	const pad = (part: number) => part.toString().padStart(2, "0");

	return `${parts.year.toString().padStart(4, "0")}${pad(parts.month)}${pad(parts.day)}T${pad(parts.hour)}${pad(parts.minute)}${pad(parts.second)}`;
};

export const foldIcsLine = (line: string) => {
	const foldedLines: string[] = [];
	let currentLine = "";
	let currentByteLength = 0;

	for (const character of line) {
		const characterByteLength = Buffer.byteLength(character, "utf8");

		if (currentLine && currentByteLength + characterByteLength > 73) {
			foldedLines.push(currentLine);
			currentLine = ` ${character}`;
			currentByteLength = 1 + characterByteLength;
			continue;
		}

		currentLine += character;
		currentByteLength += characterByteLength;
	}

	foldedLines.push(currentLine);
	return foldedLines;
};

export const buildYandexCalendarEventIcs = ({
	input,
	now,
	uid,
}: {
	input: CalendarEventDetailsInput;
	now: number;
	uid: string;
}) => {
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Graneri//Calendar//EN",
		"CALSCALE:GREGORIAN",
		"BEGIN:VEVENT",
		`UID:${uid}`,
		`DTSTAMP:${formatCalDavTimestamp(now)}`,
		input.time.kind === "all_day"
			? `DTSTART;VALUE=DATE:${formatIcsDate(input.time.startDate)}`
			: input.recurrence
				? `DTSTART;TZID=${input.recurrence.timeZone}:${formatIcsZonedDateTime(input.time.startAt, input.recurrence.timeZone)}`
				: `DTSTART:${formatIcsDateTime(input.time.startAt)}`,
		input.time.kind === "all_day"
			? `DTEND;VALUE=DATE:${formatIcsDate(input.time.endDate)}`
			: input.recurrence
				? `DTEND;TZID=${input.recurrence.timeZone}:${formatIcsZonedDateTime(input.time.endAt, input.recurrence.timeZone)}`
				: `DTEND:${formatIcsDateTime(input.time.endAt)}`,
		`SUMMARY:${escapeIcsText(input.title)}`,
		...(input.recurrence
			? [
					formatCalendarRecurrenceRule({
						isAllDay: input.time.kind === "all_day",
						recurrence: input.recurrence,
					}),
				]
			: []),
		...(input.description
			? [`DESCRIPTION:${escapeIcsText(input.description)}`]
			: []),
		...(input.location ? [`LOCATION:${escapeIcsText(input.location)}`] : []),
		...input.guests.map(
			(guest) => `ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:${guest}`,
		),
		"END:VEVENT",
		"END:VCALENDAR",
	];

	return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
};
