import type { UpcomingCalendarEvent } from "@/app/app-types";
import type {
	CalendarProvider,
	CalendarSource,
} from "@/components/calendar/calendar-view-model";

export type CalendarEventDraft = {
	allDay: boolean;
	calendarId: string;
	description: string;
	endDate: string;
	endTime: string;
	guests: string;
	location: string;
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

	return new Date(year, month - 1, day);
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

export const createInitialCalendarEventDraft = (
	calendars: CalendarSource[],
	defaultCalendarId: string | null,
): CalendarEventDraft => {
	const start = new Date();
	start.setSeconds(0, 0);
	start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30);

	const end = new Date(start);
	end.setMinutes(end.getMinutes() + 30);

	return {
		allDay: false,
		calendarId:
			calendars.find((calendar) => calendar.id === defaultCalendarId)?.id ??
			calendars[0]?.id ??
			"",
		description: "",
		endDate: toDateInputValue(end),
		endTime: toTimeInputValue(end),
		guests: "",
		location: "",
		startDate: toDateInputValue(start),
		startTime: toTimeInputValue(start),
		title: "",
	};
};

export const createCalendarEventDraftFromEvent = (
	event: UpcomingCalendarEvent,
): CalendarEventDraft => {
	const start = new Date(event.startAt);
	const end = new Date(event.endAt);

	return {
		allDay: event.isAllDay,
		calendarId: event.calendarId,
		description: event.description ?? "",
		endDate: toDateInputValue(end),
		endTime: toTimeInputValue(end),
		guests: "",
		location: event.location ?? "",
		startDate: toDateInputValue(start),
		startTime: toTimeInputValue(start),
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

	const guests = draft.guests
		.split(",")
		.map((guest) => guest.trim())
		.filter(Boolean);
	const common = {
		calendarId: draft.calendarId,
		description: draft.description.trim() || undefined,
		guests,
		location: draft.location.trim() || undefined,
		provider,
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
