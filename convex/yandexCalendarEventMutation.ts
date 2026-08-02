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

type IcsEventRange = { end: number; start: number };

const parseEditableYandexCalendar = (calendarData: string) => {
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

	return {
		baseEventLines: lines.slice(baseRange.start, baseRange.end + 1),
		baseRange,
		lines,
		ranges,
	};
};

const findIcsEventRange = ({
	lines,
	ranges,
	recurrenceId,
}: {
	lines: string[];
	ranges: IcsEventRange[];
	recurrenceId: string;
}) =>
	ranges.find(({ end, start }) => {
		const event = parseIcsEventBlock(lines.slice(start, end + 1));
		return event && getRecurrenceIdIso(event) === recurrenceId;
	});

const replaceOrAppendIcsEvent = ({
	eventLines,
	lines,
	targetRange,
}: {
	eventLines: string[];
	lines: string[];
	targetRange?: IcsEventRange;
}) => {
	if (targetRange) {
		lines.splice(
			targetRange.start,
			targetRange.end - targetRange.start + 1,
			...eventLines,
		);
		return;
	}

	const calendarEnd = lines.lastIndexOf("END:VCALENDAR");
	if (calendarEnd < 0) {
		throw new Error("The Yandex event resource has no calendar boundary.");
	}
	lines.splice(calendarEnd, 0, ...eventLines);
};

const serializeYandexCalendarLines = (lines: string[]) =>
	`${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;

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

const getManagedYandexAttendeeLines = ({
	eventLines,
	guests,
	selfEmail,
}: {
	eventLines: string[];
	guests: string[];
	selfEmail: string;
}) => {
	const existingLinesByEmail = new Map(
		eventLines.flatMap((line) => {
			if (getIcsLinePropertyName(line) !== "ATTENDEE") {
				return [];
			}

			const email = normalizeYandexAttendeeEmail(getIcsPropertyValue(line));
			return email ? ([[email, line]] as const) : [];
		}),
	);
	const organizerLine = eventLines.find(
		(line) => getIcsLinePropertyName(line) === "ORGANIZER",
	);
	const organizerEmail = organizerLine
		? normalizeYandexAttendeeEmail(getIcsPropertyValue(organizerLine))
		: null;
	const normalizedSelfEmail = normalizeYandexAttendeeEmail(selfEmail);
	const attendeeEmails = [normalizedSelfEmail, ...guests]
		.map(normalizeYandexAttendeeEmail)
		.filter((email) => email && email !== organizerEmail);

	return [...new Set(attendeeEmails)].map(
		(email) =>
			existingLinesByEmail.get(email) ??
			`ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:${email}`,
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

const getGuestOverridePreservedLines = (baseEventLines: string[]) => {
	const excludedProperties = new Set([
		"ATTENDEE",
		"CREATED",
		"DTEND",
		"DTSTAMP",
		"DTSTART",
		"DURATION",
		"EXDATE",
		"LAST-MODIFIED",
		"RDATE",
		"RECURRENCE-ID",
		"RRULE",
		"SEQUENCE",
		"STATUS",
		"UID",
	]);

	return baseEventLines
		.slice(1, -1)
		.filter((line) => !excludedProperties.has(getIcsLinePropertyName(line)));
};

const buildYandexGuestOverrideLines = ({
	baseEventLines,
	guests,
	now,
	recurrenceId,
	selfEmail,
}: {
	baseEventLines: string[];
	guests: string[];
	now: number;
	recurrenceId: string;
	selfEmail: string;
}) => {
	const baseEvent = parseIcsEventBlock(baseEventLines);
	const uid = baseEvent?.properties.UID?.value;
	const startProperty = baseEvent?.properties.DTSTART;
	const endProperty = baseEvent?.properties.DTEND ?? startProperty;
	const baseStart = startProperty
		? parseIcsDateValue(startProperty.value, startProperty.parameters, false)
		: null;
	const baseEnd = endProperty
		? parseIcsDateValue(endProperty.value, endProperty.parameters, true)
		: null;
	const occurrenceStart = new Date(recurrenceId);

	if (
		!baseEvent ||
		!uid ||
		!startProperty ||
		!baseStart ||
		!baseEnd ||
		Number.isNaN(occurrenceStart.getTime())
	) {
		throw new Error("The Yandex recurring event resource is invalid.");
	}

	const durationMs = Math.max(0, baseEnd.getTime() - baseStart.getTime());
	const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
	const isAllDay =
		startProperty.parameters.VALUE === "DATE" ||
		/^\d{8}$/u.test(startProperty.value);
	const timeLines = isAllDay
		? [
				`DTSTART;VALUE=DATE:${formatIcsDate(occurrenceStart.toISOString().slice(0, 10))}`,
				`DTEND;VALUE=DATE:${formatIcsDate(occurrenceEnd.toISOString().slice(0, 10))}`,
			]
		: [
				`DTSTART:${formatIcsDateTime(occurrenceStart.toISOString())}`,
				`DTEND:${formatIcsDateTime(occurrenceEnd.toISOString())}`,
			];

	return [
		"BEGIN:VEVENT",
		`UID:${uid}`,
		`DTSTAMP:${formatCalDavTimestamp(now)}`,
		`SEQUENCE:${getNextSequence(baseEvent)}`,
		formatYandexRecurrenceId({ isAllDay, recurrenceId }),
		...timeLines,
		...getManagedYandexAttendeeLines({
			eventLines: baseEventLines,
			guests,
			selfEmail,
		}),
		...getGuestOverridePreservedLines(baseEventLines),
		"END:VEVENT",
	];
};

const updateYandexGuestEventLines = ({
	baseEventLines,
	guests,
	now,
	selfEmail,
	targetEventLines,
}: {
	baseEventLines: string[];
	guests: string[];
	now: number;
	selfEmail: string;
	targetEventLines: string[];
}) => {
	const targetEvent = parseIcsEventBlock(targetEventLines);

	if (!targetEvent) {
		throw new Error("The Yandex event resource is invalid.");
	}

	const retainedLines = targetEventLines.slice(1, -1).filter((line) => {
		const propertyName = getIcsLinePropertyName(line);
		return (
			propertyName !== "ATTENDEE" &&
			propertyName !== "DTSTAMP" &&
			propertyName !== "SEQUENCE"
		);
	});

	return [
		"BEGIN:VEVENT",
		`DTSTAMP:${formatCalDavTimestamp(now)}`,
		`SEQUENCE:${getNextSequence(targetEvent)}`,
		...retainedLines,
		...getManagedYandexAttendeeLines({
			eventLines: [...baseEventLines, ...targetEventLines],
			guests,
			selfEmail,
		}),
		"END:VEVENT",
	];
};

export const hasYandexCalendarGuestChanges = ({
	calendarData,
	guests,
	recurrenceId,
	selfEmail,
}: {
	calendarData: string;
	guests: string[];
	recurrenceId?: string;
	selfEmail: string;
}) => {
	const { baseEventLines, baseRange, lines, ranges } =
		parseEditableYandexCalendar(calendarData);
	const targetRange = recurrenceId
		? findIcsEventRange({ lines, ranges, recurrenceId })
		: baseRange;
	const targetEventLines = targetRange
		? lines.slice(targetRange.start, targetRange.end + 1)
		: baseEventLines;
	const effectiveEventLines = targetEventLines.some(
		(line) => getIcsLinePropertyName(line) === "ATTENDEE",
	)
		? targetEventLines
		: baseEventLines;
	const organizerLine = baseEventLines.find(
		(line) => getIcsLinePropertyName(line) === "ORGANIZER",
	);
	const organizerEmail = organizerLine
		? normalizeYandexAttendeeEmail(getIcsPropertyValue(organizerLine))
		: null;
	const normalizedSelfEmail = normalizeYandexAttendeeEmail(selfEmail);
	const currentGuestEmails = new Set(
		effectiveEventLines.flatMap((line) => {
			if (getIcsLinePropertyName(line) !== "ATTENDEE") {
				return [];
			}

			const email = normalizeYandexAttendeeEmail(getIcsPropertyValue(line));
			return email && email !== organizerEmail && email !== normalizedSelfEmail
				? [email]
				: [];
		}),
	);
	const requestedGuestEmails = new Set(
		guests
			.map(normalizeYandexAttendeeEmail)
			.filter(
				(email) =>
					email && email !== organizerEmail && email !== normalizedSelfEmail,
			),
	);

	return (
		currentGuestEmails.size !== requestedGuestEmails.size ||
		[...requestedGuestEmails].some((email) => !currentGuestEmails.has(email))
	);
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
	const { baseEventLines, baseRange, lines, ranges } =
		parseEditableYandexCalendar(calendarData);
	const updatedEventLines = buildUpdatedYandexEventLines({
		baseEventLines,
		input,
		now,
	});
	const targetRange = input.recurrenceId
		? findIcsEventRange({
				lines,
				ranges,
				recurrenceId: input.recurrenceId,
			})
		: baseRange;
	replaceOrAppendIcsEvent({
		eventLines: updatedEventLines,
		lines,
		targetRange,
	});
	return serializeYandexCalendarLines(lines);
};

export const updateYandexCalendarResourceGuests = ({
	calendarData,
	guests,
	now,
	recurrenceId,
	selfEmail,
}: {
	calendarData: string;
	guests: string[];
	now: number;
	recurrenceId?: string;
	selfEmail: string;
}) => {
	const { baseEventLines, baseRange, lines, ranges } =
		parseEditableYandexCalendar(calendarData);
	const targetRange = recurrenceId
		? findIcsEventRange({ lines, ranges, recurrenceId })
		: baseRange;
	const updatedEventLines = targetRange
		? updateYandexGuestEventLines({
				baseEventLines,
				guests,
				now,
				selfEmail,
				targetEventLines: lines.slice(targetRange.start, targetRange.end + 1),
			})
		: buildYandexGuestOverrideLines({
				baseEventLines,
				guests,
				now,
				recurrenceId: recurrenceId ?? "",
				selfEmail,
			});

	replaceOrAppendIcsEvent({
		eventLines: updatedEventLines,
		lines,
		targetRange,
	});
	return serializeYandexCalendarLines(lines);
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
	const { baseEventLines, lines, ranges } =
		parseEditableYandexCalendar(calendarData);
	const cancelledEventLines = buildCancelledYandexEventLines({
		baseEventLines,
		now,
		recurrenceId,
		recurrenceIsAllDay,
	});
	const targetRange = findIcsEventRange({ lines, ranges, recurrenceId });
	replaceOrAppendIcsEvent({
		eventLines: cancelledEventLines,
		lines,
		targetRange,
	});
	return serializeYandexCalendarLines(lines);
};

export const declineYandexCalendarOccurrence = ({
	calendarData,
	recurrenceId,
	recurrenceIsAllDay,
}: {
	calendarData: string;
	recurrenceId: string;
	recurrenceIsAllDay: boolean;
}) => {
	const { baseEventLines, baseRange, lines } =
		parseEditableYandexCalendar(calendarData);

	const exclusionLine = recurrenceIsAllDay
		? `EXDATE;VALUE=DATE:${formatIcsDate(recurrenceId.slice(0, 10))}`
		: `EXDATE:${formatIcsDateTime(recurrenceId)}`;
	if (baseEventLines.some((line) => line === exclusionLine)) {
		return calendarData;
	}

	lines.splice(baseRange.end, 0, exclusionLine);
	return serializeYandexCalendarLines(lines);
};
