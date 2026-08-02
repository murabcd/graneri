import {
	createCalendarAttendee,
	normalizeCalendarAttendees,
} from "./calendarAttendees";
import {
	getCalendarWeekdayByIndex,
	parseCalendarRecurrence,
} from "./calendarRecurrence";
import { zonedCalendarDateTimeToUtc } from "./calendarTimeZone";
import type { CalendarRecurrence } from "./calendarTypes";
import type {
	ParsedIcsEvent,
	ParsedIcsProperty,
	YandexCalendarCollection,
	YandexUpcomingCalendarEvent,
} from "./yandexCalendarTypes";

const URL_PATTERN = /https?:\/\/[^\s<>"]+/giu;
const ICS_WEEKDAY_INDEX_BY_CODE: Record<string, number> = {
	FR: 5,
	MO: 1,
	SA: 6,
	SU: 0,
	TH: 4,
	TU: 2,
	WE: 3,
};

export const unfoldIcsLines = (value: string) =>
	value
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n")
		.replaceAll(/\n[ \t]/gu, "");

const decodeIcsText = (value: string) =>
	value
		.replaceAll("\\n", "\n")
		.replaceAll("\\N", "\n")
		.replaceAll("\\,", ",")
		.replaceAll("\\;", ";")
		.replaceAll("\\\\", "\\");

const tryParseUrl = (value: string) => {
	try {
		return new URL(value);
	} catch {
		return null;
	}
};

const extractUrls = (value?: string) =>
	value ? Array.from(value.matchAll(URL_PATTERN), (match) => match[0]) : [];

const isGenericYandexEventUrl = (value: string) => {
	const parsedUrl = tryParseUrl(value);

	return Boolean(
		parsedUrl &&
			(parsedUrl.hostname === "calendar.yandex.com" ||
				parsedUrl.hostname === "calendar.yandex.ru" ||
				parsedUrl.hostname === "calendar.360.yandex.ru") &&
			parsedUrl.pathname.startsWith("/event"),
	);
};

const isMeetingJoinUrl = (value: string) => {
	const parsedUrl = tryParseUrl(value);

	if (!parsedUrl || isGenericYandexEventUrl(value)) {
		return false;
	}

	const hostname = parsedUrl.hostname.toLowerCase();

	return (
		hostname === "telemost.yandex.ru" ||
		hostname === "telemost.360.yandex.ru" ||
		hostname === "meet.google.com" ||
		hostname === "teams.microsoft.com" ||
		hostname === "meetings.office.com" ||
		hostname === "zoom.us" ||
		hostname.endsWith(".zoom.us") ||
		hostname.endsWith(".webex.com")
	);
};

const parseIcsPropertyLine = (line: string) => {
	const separatorIndex = line.indexOf(":");

	if (separatorIndex < 0) {
		return null;
	}

	const rawKey = line.slice(0, separatorIndex);
	const rawValue = line.slice(separatorIndex + 1);
	const [name, ...parameterEntries] = rawKey.split(";");
	const parameters: Record<string, string> = {};

	for (const entry of parameterEntries) {
		const [parameterName, ...parameterValueParts] = entry.split("=");

		if (parameterName && parameterValueParts.length > 0) {
			parameters[parameterName.toUpperCase()] = parameterValueParts.join("=");
		}
	}

	return {
		name: name.toUpperCase(),
		parameters,
		value: rawValue,
	};
};

export const parseIcsEvents = (calendarData: string) => {
	const lines = unfoldIcsLines(calendarData).split("\n");
	const events: ParsedIcsEvent[] = [];
	let currentEvent: ParsedIcsEvent | null = null;

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();

		if (line === "BEGIN:VEVENT") {
			currentEvent = { attendees: [], properties: {} };
			continue;
		}

		if (line === "END:VEVENT") {
			if (currentEvent) {
				events.push(currentEvent);
			}
			currentEvent = null;
			continue;
		}

		if (!currentEvent) {
			continue;
		}

		const property = parseIcsPropertyLine(line);

		if (property?.name === "ATTENDEE") {
			currentEvent.attendees.push({
				parameters: property.parameters,
				value: property.value,
			});
		} else if (property && !(property.name in currentEvent.properties)) {
			currentEvent.properties[property.name] = {
				parameters: property.parameters,
				value: property.value,
			};
		}
	}

	return events;
};

type IcsDateParts = {
	day: number;
	hour: number;
	isUtc: boolean;
	minute: number;
	month: number;
	second: number;
	year: number;
};

const parseIcsDateParts = (value: string): IcsDateParts | null => {
	const match = value.match(
		/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/u,
	);

	if (!match) {
		return null;
	}

	return {
		day: Number(match[3]),
		hour: Number(match[4] ?? "0"),
		isUtc: match[7] === "Z",
		minute: Number(match[5] ?? "0"),
		month: Number(match[2]),
		second: Number(match[6] ?? "0"),
		year: Number(match[1]),
	};
};

const addDaysToDateParts = (parts: IcsDateParts, days: number) => {
	const shiftedDate = new Date(
		Date.UTC(parts.year, parts.month - 1, parts.day + days),
	);

	return {
		...parts,
		day: shiftedDate.getUTCDate(),
		month: shiftedDate.getUTCMonth() + 1,
		year: shiftedDate.getUTCFullYear(),
	};
};

const getDatePartsAfterMonths = (
	parts: IcsDateParts,
	months: number,
): IcsDateParts | null => {
	const monthIndex = parts.year * 12 + (parts.month - 1) + months;
	const year = Math.floor(monthIndex / 12);
	const month = (monthIndex % 12) + 1;
	const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

	if (parts.day > daysInMonth) {
		return null;
	}

	return { ...parts, day: parts.day, month, year };
};

const getDatePartWeekday = (parts: IcsDateParts) =>
	new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();

const parseRrule = (value: string) =>
	Object.fromEntries(
		value
			.split(";")
			.map((entry) => entry.split("="))
			.filter((entry) => entry.length === 2)
			.map(([key, parsedValue]) => [key.toUpperCase(), parsedValue]),
	);

const SIMPLE_PERIODIC_RRULE_KEYS = new Set([
	"COUNT",
	"FREQ",
	"INTERVAL",
	"UNTIL",
]);

const isSimplePeriodicRule = (rule: Record<string, string>) =>
	Object.keys(rule).every((key) => SIMPLE_PERIODIC_RRULE_KEYS.has(key));

const parsePositiveRruleInteger = (
	value: string | undefined,
	fallback: number | null,
) => {
	if (value === undefined) {
		return fallback;
	}

	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const parseIcsDateValue = (
	value: string,
	parameters: Record<string, string>,
	isEnd: boolean,
) => {
	const isAllDay = parameters.VALUE === "DATE" || /^\d{8}$/u.test(value);
	const parts = parseIcsDateParts(value);

	if (!parts) {
		return null;
	}

	if (isAllDay) {
		const timestamp = Date.UTC(parts.year, parts.month - 1, parts.day);
		return new Date(isEnd ? timestamp - 1 : timestamp);
	}

	if (parts.isUtc) {
		return new Date(
			Date.UTC(
				parts.year,
				parts.month - 1,
				parts.day,
				parts.hour,
				parts.minute,
				parts.second,
			),
		);
	}

	if (parameters.TZID) {
		return zonedCalendarDateTimeToUtc(parts, parameters.TZID);
	}

	return new Date(
		Date.UTC(
			parts.year,
			parts.month - 1,
			parts.day,
			parts.hour,
			parts.minute,
			parts.second,
		),
	);
};

const getMeetingUrl = ({
	conference,
	description,
	location,
	telemostConference,
}: {
	conference?: string;
	description?: string;
	location?: string;
	telemostConference?: string;
}) => {
	for (const candidate of [
		conference?.trim(),
		telemostConference?.trim(),
		...extractUrls(description),
		...extractUrls(location),
	]) {
		if (candidate && isMeetingJoinUrl(candidate)) {
			return candidate;
		}
	}
};

const normalizeEvent = ({
	calendar,
	event,
	href,
	minimumEndAt,
	overrideEndAt,
	overrideStartAt,
	recurrence,
	recurrenceId,
	selfEmail,
}: {
	calendar: YandexCalendarCollection;
	event: ParsedIcsEvent;
	href: string;
	minimumEndAt: number;
	overrideEndAt?: Date;
	overrideStartAt?: Date;
	recurrence?: CalendarRecurrence;
	recurrenceId?: string;
	selfEmail: string;
}): YandexUpcomingCalendarEvent | null => {
	const properties = event.properties;

	if (properties.STATUS?.value?.toUpperCase() === "CANCELLED") {
		return null;
	}

	const startProperty = properties.DTSTART;

	if (!startProperty) {
		return null;
	}

	const endProperty = properties.DTEND ?? properties.DUE ?? startProperty;
	const startAt =
		overrideStartAt ??
		parseIcsDateValue(startProperty.value, startProperty.parameters, false);
	const endAt =
		overrideEndAt ??
		parseIcsDateValue(endProperty.value, endProperty.parameters, true) ??
		startAt;

	if (!startAt || !endAt || endAt.getTime() < minimumEndAt) {
		return null;
	}

	const description = properties.DESCRIPTION
		? decodeIcsText(properties.DESCRIPTION.value).trim()
		: undefined;
	const location = properties.LOCATION
		? decodeIcsText(properties.LOCATION.value).trim()
		: undefined;
	const meetingUrl = getMeetingUrl({
		conference: properties.CONFERENCE
			? decodeIcsText(properties.CONFERENCE.value).trim()
			: undefined,
		description,
		location,
		telemostConference: properties["X-TELEMOST-CONFERENCE"]
			? decodeIcsText(properties["X-TELEMOST-CONFERENCE"].value).trim()
			: undefined,
	});
	const organizer = properties.ORGANIZER;
	const attendees = normalizeCalendarAttendees(
		[
			...event.attendees.map((attendee) =>
				createCalendarAttendee({
					displayName: attendee.parameters.CN,
					email: decodeIcsText(attendee.value),
					isOrganizer: false,
					isSelf:
						decodeIcsText(attendee.value)
							.replace(/^mailto:/iu, "")
							.trim()
							.toLowerCase() === selfEmail,
					responseStatus: attendee.parameters.PARTSTAT,
				}),
			),
			organizer
				? createCalendarAttendee({
						displayName: organizer.parameters.CN,
						email: decodeIcsText(organizer.value),
						isOrganizer: true,
						isSelf:
							decodeIcsText(organizer.value)
								.replace(/^mailto:/iu, "")
								.trim()
								.toLowerCase() === selfEmail,
						responseStatus: "accepted",
					})
				: null,
		].filter((attendee) => attendee !== null),
	);
	const organizerAttendee = attendees.find((attendee) => attendee.isOrganizer);
	const canManageEvent =
		calendar.canWrite && (organizerAttendee ? organizerAttendee.isSelf : true);
	const isSelfAttendee = attendees.some((attendee) => attendee.isSelf);
	const canInviteGuests = calendar.canWrite && isSelfAttendee;
	const startParts = parseIcsDateParts(startProperty.value);
	const normalizedRecurrence =
		recurrence ??
		(properties.RRULE
			? parseCalendarRecurrence({
					defaultWeekday: getCalendarWeekdayByIndex(
						startParts ? getDatePartWeekday(startParts) : startAt.getUTCDay(),
					),
					recurrenceLines: [properties.RRULE.value],
					timeZone: startProperty.parameters.TZID,
				})
			: undefined);

	return {
		attendees,
		canDelete: canManageEvent,
		canEdit: canManageEvent,
		guestPermissions: canManageEvent || canInviteGuests ? "manage" : "none",
		canMove: canManageEvent,
		canRemove:
			calendar.canWrite &&
			isSelfAttendee &&
			Boolean(organizerAttendee && !organizerAttendee.isSelf),
		calendarId: calendar.id,
		calendarName: calendar.displayName,
		description: description || undefined,
		endAt: endAt.toISOString(),
		htmlLink: properties.URL
			? decodeIcsText(properties.URL.value).trim()
			: undefined,
		id: `yandex:${properties.UID?.value ?? href}:${startAt.toISOString()}`,
		isAllDay:
			startProperty.parameters.VALUE === "DATE" ||
			/^\d{8}$/u.test(startProperty.value),
		isMeeting: Boolean(
			meetingUrl ||
				attendees.some(
					(attendee) =>
						!attendee.isSelf && attendee.responseStatus !== "declined",
				),
		),
		isRecurring: Boolean(properties.RRULE || properties["RECURRENCE-ID"]),
		location: location || undefined,
		meetingUrl,
		provider: "yandex",
		providerEventId: href,
		recurrence: normalizedRecurrence,
		recurrenceId,
		startAt: startAt.toISOString(),
		title: properties.SUMMARY
			? decodeIcsText(properties.SUMMARY.value).trim()
			: "Untitled event",
	};
};

const getRecurringOccurrenceStart = ({
	candidateDate,
	startProperty,
}: {
	candidateDate: IcsDateParts;
	startProperty: ParsedIcsProperty;
}) => {
	if (
		startProperty.parameters.VALUE === "DATE" ||
		/^\d{8}$/u.test(startProperty.value)
	) {
		return new Date(
			Date.UTC(candidateDate.year, candidateDate.month - 1, candidateDate.day),
		);
	}

	if (candidateDate.isUtc) {
		return new Date(
			Date.UTC(
				candidateDate.year,
				candidateDate.month - 1,
				candidateDate.day,
				candidateDate.hour,
				candidateDate.minute,
				candidateDate.second,
			),
		);
	}

	return startProperty.parameters.TZID
		? zonedCalendarDateTimeToUtc(candidateDate, startProperty.parameters.TZID)
		: new Date(
				Date.UTC(
					candidateDate.year,
					candidateDate.month - 1,
					candidateDate.day,
					candidateDate.hour,
					candidateDate.minute,
					candidateDate.second,
				),
			);
};

const expandRecurringEvent = ({
	calendar,
	event,
	href,
	minimumEndAt,
	overrideByRecurrenceId,
	selfEmail,
	timeMax,
	timeMin,
}: {
	calendar: YandexCalendarCollection;
	event: ParsedIcsEvent;
	href: string;
	minimumEndAt: number;
	overrideByRecurrenceId: Map<string, ParsedIcsEvent>;
	timeMax: number;
	timeMin: number;
	selfEmail: string;
}) => {
	const properties = event.properties;
	const startProperty = properties.DTSTART;

	if (!startProperty || !properties.RRULE) {
		return [];
	}

	const endProperty = properties.DTEND ?? properties.DUE ?? startProperty;
	const seriesStart = parseIcsDateValue(
		startProperty.value,
		startProperty.parameters,
		false,
	);
	const seriesEnd =
		parseIcsDateValue(endProperty.value, endProperty.parameters, true) ??
		seriesStart;
	const startParts = parseIcsDateParts(startProperty.value);
	const rule = parseRrule(properties.RRULE.value);

	if (!seriesStart || !seriesEnd || !startParts) {
		return [];
	}

	const recurrence = parseCalendarRecurrence({
		defaultWeekday: getCalendarWeekdayByIndex(getDatePartWeekday(startParts)),
		recurrenceLines: [properties.RRULE.value],
		timeZone: startProperty.parameters.TZID,
	});

	const durationMs = Math.max(0, seriesEnd.getTime() - seriesStart.getTime());
	const interval = parsePositiveRruleInteger(rule.INTERVAL, 1) ?? 1;
	const until = rule.UNTIL
		? (parseIcsDateValue(rule.UNTIL, {}, false)?.getTime() ?? null)
		: null;
	const count = parsePositiveRruleInteger(rule.COUNT, null);
	const occurrences: YandexUpcomingCalendarEvent[] = [];
	const appendOccurrence = (occurrenceStart: Date) => {
		const recurrenceId = occurrenceStart.toISOString();
		const overrideEvent = overrideByRecurrenceId.get(recurrenceId);
		const normalizedEvent = normalizeEvent({
			calendar,
			event: overrideEvent ?? event,
			href,
			minimumEndAt,
			overrideEndAt: overrideEvent
				? undefined
				: new Date(occurrenceStart.getTime() + durationMs),
			overrideStartAt: overrideEvent ? undefined : occurrenceStart,
			recurrence,
			recurrenceId,
			selfEmail,
		});

		if (normalizedEvent) {
			occurrences.push(normalizedEvent);
		}
	};

	if (rule.FREQ === "DAILY") {
		let occurrenceIndex = 0;
		let currentParts = startParts;

		while (true) {
			const occurrenceStart = getRecurringOccurrenceStart({
				candidateDate: currentParts,
				startProperty,
			});
			const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);

			if (
				occurrenceStart.getTime() > timeMax ||
				(until !== null && occurrenceStart.getTime() > until) ||
				(count !== null && occurrenceIndex >= count)
			) {
				break;
			}

			if (occurrenceEnd.getTime() >= timeMin) {
				appendOccurrence(occurrenceStart);
			}

			currentParts = addDaysToDateParts(currentParts, interval);
			occurrenceIndex += 1;
		}

		return occurrences;
	}

	if (rule.FREQ === "MONTHLY" || rule.FREQ === "YEARLY") {
		if (!isSimplePeriodicRule(rule)) {
			return [];
		}

		const monthInterval = rule.FREQ === "YEARLY" ? interval * 12 : interval;
		let periodIndex = 0;
		let generatedCount = 0;

		while (true) {
			const monthStartParts = getDatePartsAfterMonths(
				{ ...startParts, day: 1 },
				periodIndex * monthInterval,
			);
			if (!monthStartParts) {
				break;
			}
			const monthStart = getRecurringOccurrenceStart({
				candidateDate: monthStartParts,
				startProperty,
			});

			if (monthStart.getTime() > timeMax) {
				break;
			}

			const candidateDate = getDatePartsAfterMonths(
				startParts,
				periodIndex * monthInterval,
			);
			periodIndex += 1;

			if (!candidateDate) {
				continue;
			}

			const occurrenceStart = getRecurringOccurrenceStart({
				candidateDate,
				startProperty,
			});
			if (
				(until !== null && occurrenceStart.getTime() > until) ||
				(count !== null && generatedCount >= count)
			) {
				break;
			}

			const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
			if (occurrenceEnd.getTime() >= timeMin) {
				appendOccurrence(occurrenceStart);
			}
			generatedCount += 1;
		}

		return occurrences;
	}

	if (rule.FREQ !== "WEEKLY") {
		return [];
	}

	const configuredDays = (rule.BYDAY ?? "")
		.split(",")
		.map((value) => value.trim().toUpperCase())
		.filter(Boolean)
		.map((code) => ICS_WEEKDAY_INDEX_BY_CODE[code])
		.filter((value) => value !== undefined);
	const byDays =
		configuredDays.length > 0
			? configuredDays
			: [getDatePartWeekday(startParts)];
	let daysFromSeriesStart = 0;
	let generatedCount = 0;

	while (true) {
		const candidateDate = addDaysToDateParts(startParts, daysFromSeriesStart);
		const occurrenceStart = getRecurringOccurrenceStart({
			candidateDate,
			startProperty,
		});
		const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);

		if (occurrenceStart.getTime() > timeMax) {
			break;
		}

		const weekOffset = Math.floor(daysFromSeriesStart / 7);
		const matchesWeeklyRule =
			weekOffset % interval === 0 &&
			byDays.includes(getDatePartWeekday(candidateDate));

		if (
			matchesWeeklyRule &&
			(until === null || occurrenceStart.getTime() <= until) &&
			(count === null || generatedCount < count)
		) {
			if (occurrenceEnd.getTime() >= timeMin) {
				appendOccurrence(occurrenceStart);
			}
			generatedCount += 1;
		}

		daysFromSeriesStart += 1;
	}

	return occurrences;
};

export const parseYandexCalendarData = ({
	calendar,
	calendarData,
	href,
	minimumEndAt,
	selfEmail,
	timeMax,
	timeMin,
}: {
	calendar: YandexCalendarCollection;
	calendarData: string;
	href: string;
	minimumEndAt: number;
	timeMax: number;
	timeMin: number;
	selfEmail: string;
}) => {
	const parsedEvents = parseIcsEvents(calendarData);
	const overridesByUid = new Map<string, Map<string, ParsedIcsEvent>>();

	for (const event of parsedEvents) {
		const properties = event.properties;

		if (!properties["RECURRENCE-ID"] || !properties.UID) {
			continue;
		}

		const recurrenceId = parseIcsDateValue(
			properties["RECURRENCE-ID"].value,
			properties["RECURRENCE-ID"].parameters,
			false,
		)?.toISOString();

		if (!recurrenceId) {
			continue;
		}

		const overrides =
			overridesByUid.get(properties.UID.value) ??
			new Map<string, ParsedIcsEvent>();
		overrides.set(recurrenceId, event);
		overridesByUid.set(properties.UID.value, overrides);
	}

	return parsedEvents.flatMap((event) => {
		const properties = event.properties;

		if (properties["RECURRENCE-ID"]) {
			return [];
		}

		if (properties.RRULE) {
			return expandRecurringEvent({
				calendar,
				event,
				href,
				minimumEndAt,
				overrideByRecurrenceId:
					overridesByUid.get(properties.UID?.value ?? "") ?? new Map(),
				selfEmail,
				timeMax,
				timeMin,
			});
		}

		const normalizedEvent = normalizeEvent({
			calendar,
			event,
			href,
			minimumEndAt,
			selfEmail,
		});
		return normalizedEvent ? [normalizedEvent] : [];
	});
};
