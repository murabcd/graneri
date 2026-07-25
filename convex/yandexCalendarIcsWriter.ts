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
			: `DTSTART:${formatIcsDateTime(input.time.startAt)}`,
		input.time.kind === "all_day"
			? `DTEND;VALUE=DATE:${formatIcsDate(input.time.endDate)}`
			: `DTEND:${formatIcsDateTime(input.time.endAt)}`,
		`SUMMARY:${escapeIcsText(input.title)}`,
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
