import { Temporal } from "@js-temporal/polyfill";
import { RRule } from "rrule";

const MAX_RRULE_LENGTH = 512;
const MIN_AUTOMATION_INTERVAL_MS = 60 * 60 * 1_000;
const RECURRENCE_INTERVAL_SAMPLE_SIZE = 128;
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

const normalizeTimezone = (timezone) => {
	const normalized = timezone.trim();
	if (!normalized) {
		throw new Error("Automation timezone is required.");
	}

	try {
		Temporal.Now.zonedDateTimeISO(normalized);
	} catch {
		throw new Error("Automation timezone must be a valid IANA timezone.");
	}

	return normalized;
};

const normalizeLocalDateTime = (value) => {
	const normalized = value.trim();
	if (!LOCAL_DATE_TIME_PATTERN.test(normalized)) {
		throw new Error(
			"Automation start time must be a local ISO date and time without an offset.",
		);
	}

	return Temporal.PlainDateTime.from(normalized)
		.with({ millisecond: 0, microsecond: 0, nanosecond: 0 })
		.toString({ smallestUnit: "second" });
};

const normalizeRrule = (value) => {
	const normalized = value
		.trim()
		.replace(/^RRULE:/i, "")
		.toUpperCase();
	if (!normalized || normalized.length > MAX_RRULE_LENGTH) {
		throw new Error("Automation recurrence rule is invalid.");
	}
	if (/[\r\n]/.test(normalized) || normalized.includes("DTSTART")) {
		throw new Error("Automation recurrence must contain one RRULE only.");
	}

	let options;
	try {
		options = RRule.parseString(normalized);
	} catch {
		throw new Error("Automation recurrence rule is invalid.");
	}

	if (options.freq === RRule.MINUTELY || options.freq === RRule.SECONDLY) {
		throw new Error("Automations cannot run more than once per hour.");
	}
	if ((options.interval ?? 1) < 1) {
		throw new Error("Automation recurrence interval must be at least one.");
	}

	return normalized;
};

const toFloatingDate = (plainDateTime) =>
	new Date(
		Date.UTC(
			plainDateTime.year,
			plainDateTime.month - 1,
			plainDateTime.day,
			plainDateTime.hour,
			plainDateTime.minute,
			plainDateTime.second,
		),
	);

const fromFloatingDate = (date) =>
	new Temporal.PlainDateTime(
		date.getUTCFullYear(),
		date.getUTCMonth() + 1,
		date.getUTCDate(),
		date.getUTCHours(),
		date.getUTCMinutes(),
		date.getUTCSeconds(),
	);

const getFloatingUntil = (rrule, timezone) => {
	const match = /(?:^|;)UNTIL=(\d{8}T\d{6}Z?)(?:;|$)/.exec(rrule);
	if (!match?.[1]) {
		return undefined;
	}

	const value = match[1];
	const year = Number(value.slice(0, 4));
	const month = Number(value.slice(4, 6));
	const day = Number(value.slice(6, 8));
	const hour = Number(value.slice(9, 11));
	const minute = Number(value.slice(11, 13));
	const second = Number(value.slice(13, 15));

	if (value.endsWith("Z")) {
		const instant = Temporal.Instant.from(
			`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`,
		);
		return toFloatingDate(
			instant.toZonedDateTimeISO(timezone).toPlainDateTime(),
		);
	}

	return toFloatingDate(
		new Temporal.PlainDateTime(year, month, day, hour, minute, second),
	);
};

const buildFloatingRule = (schedule) => {
	const options = RRule.parseString(schedule.rrule);
	return new RRule({
		...options,
		dtstart: toFloatingDate(Temporal.PlainDateTime.from(schedule.startsAt)),
		until: getFloatingUntil(schedule.rrule, schedule.timezone) ?? options.until,
	});
};

const requireMinimumRecurrenceInterval = (schedule) => {
	const rule = buildFloatingRule(schedule);
	const start = toFloatingDate(Temporal.PlainDateTime.from(schedule.startsAt));
	let previous = rule.after(new Date(start.getTime() - 1), false);
	for (
		let index = 1;
		previous && index < RECURRENCE_INTERVAL_SAMPLE_SIZE;
		index += 1
	) {
		const next = rule.after(previous, false);
		if (!next) {
			return;
		}
		if (next.getTime() - previous.getTime() < MIN_AUTOMATION_INTERVAL_MS) {
			throw new Error("Automations cannot run more than once per hour.");
		}
		previous = next;
	}
};

export const normalizeAutomationSchedule = (schedule) => {
	const timezone = normalizeTimezone(schedule.timezone);

	if (schedule.kind === "once") {
		if (!Number.isFinite(schedule.at)) {
			throw new Error("Automation run time is invalid.");
		}

		return {
			kind: "once",
			at: Math.trunc(schedule.at),
			timezone,
		};
	}

	const normalized = {
		kind: "recurring",
		rrule: normalizeRrule(schedule.rrule),
		startsAt: normalizeLocalDateTime(schedule.startsAt),
		timezone,
	};
	requireMinimumRecurrenceInterval(normalized);
	return normalized;
};

export const getNextAutomationRunAt = ({ from, schedule }) => {
	const normalized = normalizeAutomationSchedule(schedule);
	if (normalized.kind === "once") {
		return normalized.at > from ? normalized.at : null;
	}

	const rule = buildFloatingRule(normalized);
	const localFrom = Temporal.Instant.fromEpochMilliseconds(Math.trunc(from))
		.toZonedDateTimeISO(normalized.timezone)
		.toPlainDateTime();
	let floatingCandidate = rule.after(toFloatingDate(localFrom), false);

	for (let attempt = 0; floatingCandidate && attempt < 8; attempt += 1) {
		const candidate = fromFloatingDate(floatingCandidate)
			.toZonedDateTime(normalized.timezone, { disambiguation: "compatible" })
			.toInstant().epochMilliseconds;
		if (candidate > from) {
			return candidate;
		}
		floatingCandidate = rule.after(floatingCandidate, false);
	}

	return null;
};

export const createSimpleAutomationSchedule = ({
	frequency,
	scheduledAt,
	timezone,
	weekdays,
}) => {
	const normalizedTimezone = normalizeTimezone(timezone);
	const instant = Temporal.Instant.fromEpochMilliseconds(
		Math.trunc(scheduledAt),
	);
	const local = instant
		.toZonedDateTimeISO(normalizedTimezone)
		.toPlainDateTime();
	return createAutomationScheduleFromLocal({
		frequency,
		startsAt: local.toString({ smallestUnit: "second" }),
		timezone: normalizedTimezone,
		weekdays,
	});
};

export const createAutomationScheduleFromLocal = ({
	frequency,
	startsAt,
	timezone,
	weekdays,
}) => {
	const normalizedTimezone = normalizeTimezone(timezone);
	const local = Temporal.PlainDateTime.from(normalizeLocalDateTime(startsAt));

	if (frequency === "once") {
		return normalizeAutomationSchedule({
			kind: "once",
			at: local
				.toZonedDateTime(normalizedTimezone, {
					disambiguation: "compatible",
				})
				.toInstant().epochMilliseconds,
			timezone: normalizedTimezone,
		});
	}

	const weekdayList =
		frequency === "weekdays"
			? [1, 2, 3, 4, 5]
			: frequency === "weekly"
				? weekdays?.length
					? weekdays
					: [local.dayOfWeek]
				: [];
	const byDay = weekdayList.length
		? `;BYDAY=${[...new Set(weekdayList)]
				.map((day) => WEEKDAY_CODES[day - 1])
				.filter(Boolean)
				.join(",")}`
		: "";
	const recurrence = {
		hourly: "FREQ=HOURLY",
		daily: "FREQ=DAILY",
		weekdays: `FREQ=WEEKLY${byDay}`,
		weekly: `FREQ=WEEKLY${byDay}`,
		monthly: `FREQ=MONTHLY;BYMONTHDAY=${local.day}`,
	}[frequency];

	if (!recurrence) {
		throw new Error("Unsupported automation schedule frequency.");
	}

	return normalizeAutomationSchedule({
		kind: "recurring",
		rrule: recurrence,
		startsAt: local.toString({ smallestUnit: "second" }),
		timezone: normalizedTimezone,
	});
};

export const createCustomAutomationScheduleFromLocal = ({
	frequency,
	interval,
	startsAt,
	timezone,
	weekdays,
}) => {
	const normalizedInterval = Math.trunc(interval);
	if (!Number.isFinite(interval) || normalizedInterval < 1) {
		throw new Error("Automation recurrence interval must be at least one.");
	}

	const normalizedTimezone = normalizeTimezone(timezone);
	const local = Temporal.PlainDateTime.from(normalizeLocalDateTime(startsAt));
	const intervalRule = `;INTERVAL=${normalizedInterval}`;
	let recurrence;

	if (frequency === "hourly") {
		recurrence = `FREQ=HOURLY${intervalRule}`;
	} else if (frequency === "daily") {
		recurrence = `FREQ=DAILY${intervalRule}`;
	} else if (frequency === "weekly") {
		const weekdayList = weekdays?.length ? weekdays : [local.dayOfWeek];
		const byDay = [...new Set(weekdayList)]
			.map((day) => WEEKDAY_CODES[day - 1])
			.filter(Boolean)
			.join(",");
		recurrence = `FREQ=WEEKLY${intervalRule};BYDAY=${byDay}`;
	} else if (frequency === "monthly") {
		recurrence = `FREQ=MONTHLY${intervalRule};BYMONTHDAY=${local.day}`;
	} else if (frequency === "yearly") {
		recurrence = `FREQ=YEARLY${intervalRule};BYMONTH=${local.month};BYMONTHDAY=${local.day}`;
	} else {
		throw new Error("Unsupported custom automation frequency.");
	}

	return normalizeAutomationSchedule({
		kind: "recurring",
		rrule: recurrence,
		startsAt: local.toString({ smallestUnit: "second" }),
		timezone: normalizedTimezone,
	});
};

export const getAutomationCustomRecurrence = (schedule) => {
	if (schedule.kind === "once") {
		return {
			frequency: "daily",
			interval: 1,
		};
	}

	const options = RRule.parseString(schedule.rrule);
	const frequency =
		options.freq === RRule.HOURLY
			? "hourly"
			: options.freq === RRule.WEEKLY
				? "weekly"
				: options.freq === RRule.MONTHLY
					? "monthly"
					: options.freq === RRule.YEARLY
						? "yearly"
						: "daily";
	return {
		frequency,
		interval: options.interval ?? 1,
	};
};

export const getAutomationScheduleStartAt = (schedule) => {
	const normalized = normalizeAutomationSchedule(schedule);
	if (normalized.kind === "once") {
		return normalized.at;
	}

	return Temporal.PlainDateTime.from(normalized.startsAt)
		.toZonedDateTime(normalized.timezone, { disambiguation: "compatible" })
		.toInstant().epochMilliseconds;
};

export const getAutomationScheduleLocalStart = (schedule) => {
	const normalized = normalizeAutomationSchedule(schedule);
	if (normalized.kind === "recurring") {
		return normalized.startsAt;
	}

	return Temporal.Instant.fromEpochMilliseconds(normalized.at)
		.toZonedDateTimeISO(normalized.timezone)
		.toPlainDateTime()
		.toString({ smallestUnit: "second" });
};

export const getAutomationScheduleWeekdays = (schedule) => {
	const normalized = normalizeAutomationSchedule(schedule);
	if (normalized.kind === "once") {
		return [];
	}

	const options = RRule.parseString(normalized.rrule);
	return (options.byweekday ?? [])
		.map((weekday) =>
			typeof weekday === "number" ? weekday + 1 : weekday.weekday + 1,
		)
		.filter((weekday) => weekday >= 1 && weekday <= 7);
};

export const getAutomationScheduleKind = (schedule) => {
	if (schedule.kind === "once") {
		return "once";
	}

	const options = RRule.parseString(schedule.rrule);
	if (/(?:^|;)INTERVAL=/i.test(schedule.rrule)) {
		return "custom";
	}
	if (options.freq === RRule.HOURLY) {
		return "hourly";
	}
	if (options.freq === RRule.DAILY) {
		return "daily";
	}
	if (options.freq === RRule.WEEKLY) {
		const weekdays = options.byweekday ?? [];
		const weekdayNumbers = weekdays.map((weekday) =>
			typeof weekday === "number" ? weekday : weekday.weekday,
		);
		if (
			weekdayNumbers.length === 5 &&
			weekdayNumbers.every((day, index) => day === index)
		) {
			return "weekdays";
		}
		return "weekly";
	}
	if (options.freq === RRule.MONTHLY) {
		return "monthly";
	}
	return "custom";
};
