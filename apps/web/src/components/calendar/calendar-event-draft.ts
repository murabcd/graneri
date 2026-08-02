import type { UpcomingCalendarEvent } from "@/app/app-types";
import { getAllDayDisplayDate } from "@/components/calendar/calendar-all-day-date";
import type {
	CalendarProvider,
	CalendarSource,
} from "@/components/calendar/calendar-view-model";

export type CalendarRecurrenceFrequency =
	| "daily"
	| "weekly"
	| "monthly"
	| "yearly";

export type CalendarRecurrenceWeekday =
	| "mon"
	| "tue"
	| "wed"
	| "thu"
	| "fri"
	| "sat"
	| "sun";

export type CalendarEventRecurrenceDraft = {
	enabled: boolean;
	endDate: string;
	endMode: "never" | "on_date";
	frequency: CalendarRecurrenceFrequency;
	interval: number | null;
	weekdays: CalendarRecurrenceWeekday[];
};

export type CalendarEventDraft = {
	allDay: boolean;
	calendarId: string;
	description: string;
	endDate: string;
	endTime: string;
	guests: string[];
	location: string;
	recurrence: CalendarEventRecurrenceDraft;
	startDate: string;
	startTime: string;
	title: string;
};

export type CalendarEventCreation = {
	calendarId: string;
	description?: string;
	guests: string[];
	location?: string;
	provider: CalendarProvider;
	recurrence?: {
		end: { kind: "never" } | { date: string; kind: "on_date" };
		frequency: CalendarRecurrenceFrequency;
		interval: number;
		timeZone: string;
		weekdays: CalendarRecurrenceWeekday[];
	};
	time:
		| {
				kind: "all_day";
				endDate: string;
				startDate: string;
		  }
		| {
				kind: "timed";
				endAt: string;
				startAt: string;
		  };
	title: string;
};

export const toDateInputValue = (date: Date) => {
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${year}-${month}-${day}`;
};

export const fromDateInputValue = (value: string) => {
	const [year, month, day] = value.split("-").map(Number);

	if (!year || !month || !day) {
		return undefined;
	}

	const date = new Date(year, month - 1, day);
	return toDateInputValue(date) === value ? date : undefined;
};

const formatEventDate = (date: Date) =>
	date.toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
	});

export const formatEventDateRange = (startDate: Date, endDate: Date) => {
	if (toDateInputValue(startDate) === toDateInputValue(endDate)) {
		return formatEventDate(startDate);
	}

	return `${formatEventDate(startDate)} – ${formatEventDate(endDate)}`;
};

const toTimeInputValue = (date: Date) =>
	`${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;

const WEEKDAY_BY_INDEX = [
	"sun",
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
] as const satisfies readonly CalendarRecurrenceWeekday[];

export const getCalendarRecurrenceWeekday = (dateValue: string) => {
	const date = fromDateInputValue(dateValue);
	return date ? WEEKDAY_BY_INDEX[date.getDay()] : undefined;
};

const createInitialRecurrenceDraft = (
	startDate: string,
): CalendarEventRecurrenceDraft => {
	const endDate = fromDateInputValue(startDate) ?? new Date();
	endDate.setDate(endDate.getDate() + 28);
	const weekday = getCalendarRecurrenceWeekday(startDate);

	return {
		enabled: false,
		endDate: toDateInputValue(endDate),
		endMode: "never",
		frequency: "weekly",
		interval: 1,
		weekdays: weekday ? [weekday] : ["mon"],
	};
};

export const createInitialCalendarEventDraft = (
	calendars: CalendarSource[],
	defaultCalendarId: string | null,
): CalendarEventDraft => {
	const start = new Date();
	start.setSeconds(0, 0);
	start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30);

	const end = new Date(start);
	end.setMinutes(end.getMinutes() + 30);
	const startDate = toDateInputValue(start);

	return {
		allDay: false,
		calendarId:
			calendars.find((calendar) => calendar.id === defaultCalendarId)?.id ??
			calendars[0]?.id ??
			"",
		description: "",
		endDate: toDateInputValue(end),
		endTime: toTimeInputValue(end),
		guests: [],
		location: "",
		recurrence: createInitialRecurrenceDraft(startDate),
		startDate,
		startTime: toTimeInputValue(start),
		title: "",
	};
};

export const getCalendarEventGuestEmails = (
	event: UpcomingCalendarEvent,
): string[] => {
	const guestEmails: string[] = [];

	for (const attendee of event.attendees) {
		if (!attendee.isOrganizer && !attendee.isSelf) {
			guestEmails.push(attendee.email);
		}
	}

	return guestEmails;
};

export const createCalendarEventDraftFromEvent = (
	event: UpcomingCalendarEvent,
): CalendarEventDraft => {
	const start = new Date(event.startAt);
	const end = new Date(event.endAt);
	const draftStart = event.isAllDay ? getAllDayDisplayDate(start) : start;
	const draftEnd = event.isAllDay ? getAllDayDisplayDate(end) : end;
	const startDate = toDateInputValue(draftStart);

	return {
		allDay: event.isAllDay,
		calendarId: event.calendarId,
		description: event.description ?? "",
		endDate: toDateInputValue(draftEnd),
		endTime: toTimeInputValue(draftEnd),
		guests: getCalendarEventGuestEmails(event),
		location: event.location ?? "",
		recurrence: createInitialRecurrenceDraft(startDate),
		startDate,
		startTime: toTimeInputValue(draftStart),
		title: event.title,
	};
};

const getExclusiveEndDate = (value: string) => {
	const endDate = fromDateInputValue(value);

	if (!endDate) {
		return null;
	}

	endDate.setDate(endDate.getDate() + 1);
	return toDateInputValue(endDate);
};

const toCalendarEventRecurrence = (
	draft: CalendarEventDraft,
): CalendarEventCreation["recurrence"] => {
	const recurrence = draft.recurrence;

	if (!recurrence.enabled) {
		return undefined;
	}

	if (
		recurrence.interval === null ||
		!Number.isSafeInteger(recurrence.interval) ||
		recurrence.interval < 1 ||
		recurrence.interval > 999
	) {
		throw new Error("Repeat interval must be between 1 and 999.");
	}

	if (recurrence.frequency === "weekly" && recurrence.weekdays.length === 0) {
		throw new Error("Select at least one weekday.");
	}

	let end: NonNullable<CalendarEventCreation["recurrence"]>["end"];
	if (recurrence.endMode === "on_date") {
		const endDate = fromDateInputValue(recurrence.endDate);
		if (
			!endDate ||
			toDateInputValue(endDate) !== recurrence.endDate ||
			recurrence.endDate < draft.startDate
		) {
			throw new Error("Repeat end date must be on or after the event date.");
		}
		end = { date: recurrence.endDate, kind: "on_date" };
	} else {
		end = { kind: "never" };
	}

	return {
		end,
		frequency: recurrence.frequency,
		interval: recurrence.interval,
		timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		weekdays: recurrence.frequency === "weekly" ? recurrence.weekdays : [],
	};
};

export const toCalendarEventCreation = (
	draft: CalendarEventDraft,
	provider: CalendarProvider,
): CalendarEventCreation => {
	const title = draft.title.trim();

	if (!title) {
		throw new Error("Enter an event title.");
	}

	if (!draft.calendarId) {
		throw new Error("Select a calendar.");
	}

	const common = {
		calendarId: draft.calendarId,
		description: draft.description.trim() || undefined,
		guests: draft.guests,
		location: draft.location.trim() || undefined,
		provider,
		recurrence: toCalendarEventRecurrence(draft),
		title,
	};

	if (draft.allDay) {
		const exclusiveEndDate = getExclusiveEndDate(draft.endDate);

		if (
			!fromDateInputValue(draft.startDate) ||
			!exclusiveEndDate ||
			draft.endDate < draft.startDate
		) {
			throw new Error("Select a valid event date range.");
		}

		return {
			...common,
			time: {
				kind: "all_day",
				endDate: exclusiveEndDate,
				startDate: draft.startDate,
			},
		};
	}

	const startAt = new Date(`${draft.startDate}T${draft.startTime}:00`);
	const endAt = new Date(`${draft.endDate}T${draft.endTime}:00`);

	if (
		!Number.isFinite(startAt.getTime()) ||
		!Number.isFinite(endAt.getTime()) ||
		endAt.getTime() <= startAt.getTime()
	) {
		throw new Error("Select a valid event time range.");
	}

	return {
		...common,
		time: {
			kind: "timed",
			endAt: endAt.toISOString(),
			startAt: startAt.toISOString(),
		},
	};
};
