import type { UpdateCalendarEventInput } from "./calendarTypes";
import {
	parseIcsDateValue,
	parseIcsEvents,
	unfoldIcsLines,
} from "./yandexCalendarIcs";
import {
	escapeIcsText,
	foldIcsLine,
	formatCalDavTimestamp,
	formatIcsDate,
	formatIcsDateTime,
} from "./yandexCalendarIcsWriter";
import type { ParsedIcsEvent } from "./yandexCalendarTypes";

const getIcsLinePropertyName = (line: string) =>
	line.slice(0, line.search(/[:;]/u)).toUpperCase();

const getIcsEventBlockRanges = (lines: string[]) => {
	const ranges: Array<{ end: number; start: number }> = [];
	let start = -1;

	for (let index = 0; index < lines.length; index += 1) {
		if (lines[index] === "BEGIN:VEVENT") {
			start = index;
			continue;
		}

		if (lines[index] === "END:VEVENT" && start >= 0) {
			ranges.push({ start, end: index });
			start = -1;
		}
	}

	return ranges;
};

const parseIcsEventBlock = (lines: string[]) =>
	parseIcsEvents(lines.join("\r\n"))[0] ?? null;

const getRecurrenceIdIso = (event: ParsedIcsEvent) => {
	const recurrenceId = event.properties["RECURRENCE-ID"];

	if (!recurrenceId) {
		return undefined;
	}

	return (
		parseIcsDateValue(
			recurrenceId.value,
			recurrenceId.parameters,
			false,
		)?.toISOString() ?? undefined
	);
};

const getPreservedEventLines = ({
	eventLines,
	isOverride,
}: {
	eventLines: string[];
	isOverride: boolean;
}) => {
	const excludedProperties = new Set([
		"DESCRIPTION",
		"ATTENDEE",
		"DTEND",
		"DTSTAMP",
		"DTSTART",
		"DURATION",
		"LAST-MODIFIED",
		"LOCATION",
		"SEQUENCE",
		"SUMMARY",
		"UID",
		...(isOverride
			? ["CREATED", "EXDATE", "RDATE", "RECURRENCE-ID", "RRULE", "STATUS"]
			: []),
	]);
	const preservedLines: string[] = [];
	let nestedComponentDepth = 0;

	for (const line of eventLines.slice(1, -1)) {
		if (line.startsWith("BEGIN:")) {
			nestedComponentDepth += 1;
			preservedLines.push(line);
			continue;
		}

		if (nestedComponentDepth > 0) {
			preservedLines.push(line);
			if (line.startsWith("END:")) {
				nestedComponentDepth -= 1;
			}
			continue;
		}

		if (!excludedProperties.has(getIcsLinePropertyName(line))) {
			preservedLines.push(line);
		}
	}

	return preservedLines;
};

const getIcsPropertyValue = (line: string) => {
	const separatorIndex = line.indexOf(":");
	return separatorIndex >= 0 ? line.slice(separatorIndex + 1) : "";
};

export const normalizeYandexAttendeeEmail = (value: string) =>
	value
		.replace(/^mailto:/iu, "")
		.trim()
		.toLowerCase();

const getUpdatedYandexAttendeeLines = ({
	baseEventLines,
	guests,
}: {
	baseEventLines: string[];
	guests: string[];
}) => {
	const existingLinesByEmail = new Map(
		baseEventLines.flatMap((line) => {
			if (getIcsLinePropertyName(line) !== "ATTENDEE") {
				return [];
			}

			const email = normalizeYandexAttendeeEmail(getIcsPropertyValue(line));
			return email ? ([[email, line]] as const) : [];
		}),
	);

	return guests.map(
		(guest) =>
			existingLinesByEmail.get(normalizeYandexAttendeeEmail(guest)) ??
			`ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:${guest}`,
	);
};

const getNextSequence = (event: ParsedIcsEvent) => {
	const sequence = Number(event.properties.SEQUENCE?.value ?? "0");
	return Number.isFinite(sequence) ? Math.max(0, sequence) + 1 : 1;
};

const buildYandexEventTimeLines = (time: UpdateCalendarEventInput["time"]) =>
	time.kind === "all_day"
		? [
				`DTSTART;VALUE=DATE:${formatIcsDate(time.startDate)}`,
				`DTEND;VALUE=DATE:${formatIcsDate(time.endDate)}`,
			]
		: [
				`DTSTART:${formatIcsDateTime(time.startAt)}`,
				`DTEND:${formatIcsDateTime(time.endAt)}`,
			];

const formatYandexRecurrenceId = ({
	isAllDay,
	recurrenceId,
}: {
	isAllDay: boolean;
	recurrenceId: string;
}) =>
	isAllDay
		? `RECURRENCE-ID;VALUE=DATE:${formatIcsDate(
				new Date(recurrenceId).toISOString().slice(0, 10),
			)}`
		: `RECURRENCE-ID:${formatIcsDateTime(recurrenceId)}`;

const buildUpdatedYandexEventLines = ({
	baseEventLines,
	input,
	now,
}: {
	baseEventLines: string[];
	input: UpdateCalendarEventInput;
	now: number;
}) => {
	const baseEvent = parseIcsEventBlock(baseEventLines);
	const uid = baseEvent?.properties.UID?.value;

	if (!baseEvent || !uid) {
		throw new Error("The Yandex event resource is invalid.");
	}

	const isOverride = Boolean(input.recurrenceId);
	return [
		"BEGIN:VEVENT",
		`UID:${uid}`,
		`DTSTAMP:${formatCalDavTimestamp(now)}`,
		`SEQUENCE:${getNextSequence(baseEvent)}`,
		...(input.recurrenceId
			? [
					formatYandexRecurrenceId({
						isAllDay: input.recurrenceIsAllDay ?? false,
						recurrenceId: input.recurrenceId,
					}),
				]
			: []),
		...buildYandexEventTimeLines(input.time),
		`SUMMARY:${escapeIcsText(input.title)}`,
		...(input.description
			? [`DESCRIPTION:${escapeIcsText(input.description)}`]
			: []),
		...(input.location ? [`LOCATION:${escapeIcsText(input.location)}`] : []),
		...getUpdatedYandexAttendeeLines({
			baseEventLines,
			guests: input.guests,
		}),
		...getPreservedEventLines({
			eventLines: baseEventLines,
			isOverride,
		}),
		"END:VEVENT",
	];
};

const buildCancelledYandexEventLines = ({
	baseEventLines,
	now,
	recurrenceId,
	recurrenceIsAllDay,
}: {
	baseEventLines: string[];
	now: number;
	recurrenceId: string;
	recurrenceIsAllDay: boolean;
}) => {
	const baseEvent = parseIcsEventBlock(baseEventLines);
	const uid = baseEvent?.properties.UID?.value;

	if (!baseEvent || !uid) {
		throw new Error("The Yandex event resource is invalid.");
	}

	return [
		"BEGIN:VEVENT",
		`UID:${uid}`,
		`DTSTAMP:${formatCalDavTimestamp(now)}`,
		`SEQUENCE:${getNextSequence(baseEvent)}`,
		formatYandexRecurrenceId({
			isAllDay: recurrenceIsAllDay,
			recurrenceId,
		}),
		"STATUS:CANCELLED",
		"END:VEVENT",
	];
};

export const updateYandexCalendarResource = ({
	calendarData,
	input,
	now,
}: {
	calendarData: string;
	input: UpdateCalendarEventInput;
	now: number;
}) => {
	const lines = unfoldIcsLines(calendarData)
		.split("\n")
		.map((line) => line.trimEnd());
	const ranges = getIcsEventBlockRanges(lines);
	const baseRange = ranges.find(({ end, start }) => {
		const event = parseIcsEventBlock(lines.slice(start, end + 1));
		return event && !event.properties["RECURRENCE-ID"];
	});

	if (!baseRange) {
		throw new Error("The Yandex event resource has no editable event.");
	}

	const baseEventLines = lines.slice(baseRange.start, baseRange.end + 1);
	const updatedEventLines = buildUpdatedYandexEventLines({
		baseEventLines,
		input,
		now,
	});
	const targetRange = input.recurrenceId
		? ranges.find(({ end, start }) => {
				const event = parseIcsEventBlock(lines.slice(start, end + 1));
				return event && getRecurrenceIdIso(event) === input.recurrenceId;
			})
		: baseRange;

	if (targetRange) {
		lines.splice(
			targetRange.start,
			targetRange.end - targetRange.start + 1,
			...updatedEventLines,
		);
	} else {
		const calendarEnd = lines.lastIndexOf("END:VCALENDAR");

		if (calendarEnd < 0) {
			throw new Error("The Yandex event resource has no calendar boundary.");
		}

		lines.splice(calendarEnd, 0, ...updatedEventLines);
	}

	return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
};

export const cancelYandexCalendarOccurrence = ({
	calendarData,
	now,
	recurrenceId,
	recurrenceIsAllDay,
}: {
	calendarData: string;
	now: number;
	recurrenceId: string;
	recurrenceIsAllDay: boolean;
}) => {
	const lines = unfoldIcsLines(calendarData)
		.split("\n")
		.map((line) => line.trimEnd());
	const ranges = getIcsEventBlockRanges(lines);
	const baseRange = ranges.find(({ end, start }) => {
		const event = parseIcsEventBlock(lines.slice(start, end + 1));
		return event && !event.properties["RECURRENCE-ID"];
	});

	if (!baseRange) {
		throw new Error("The Yandex event resource has no editable event.");
	}

	const cancelledEventLines = buildCancelledYandexEventLines({
		baseEventLines: lines.slice(baseRange.start, baseRange.end + 1),
		now,
		recurrenceId,
		recurrenceIsAllDay,
	});
	const targetRange = ranges.find(({ end, start }) => {
		const event = parseIcsEventBlock(lines.slice(start, end + 1));
		return event && getRecurrenceIdIso(event) === recurrenceId;
	});

	if (targetRange) {
		lines.splice(
			targetRange.start,
			targetRange.end - targetRange.start + 1,
			...cancelledEventLines,
		);
	} else {
		const calendarEnd = lines.lastIndexOf("END:VCALENDAR");

		if (calendarEnd < 0) {
			throw new Error("The Yandex event resource has no calendar boundary.");
		}

		lines.splice(calendarEnd, 0, ...cancelledEventLines);
	}

	return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
};
