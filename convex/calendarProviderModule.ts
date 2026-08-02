import { ConvexError } from "convex/values";
import { normalizeEmail } from "./calendarAttendees";
import { isCalendarDateValue } from "./calendarDate";
import { normalizeCalendarEventRecurrenceInput } from "./calendarRecurrence";
import type {
	CalendarEventDetailsInput,
	CalendarEventsFetchResult,
	CalendarProvider,
	CalendarSource,
	CreateCalendarEventInput,
	UpcomingCalendarEvent,
	UpdateCalendarEventInput,
} from "./calendarTypes";

export type CalendarProviderReadInput = {
	eventLimit: number;
	minimumEndAt: number;
	timeMax: number;
	timeMin: number;
};

export type CreateCalendarInput = {
	color: string;
	name: string;
};

export type UpdateCalendarInput = CreateCalendarInput & {
	calendarId: string;
};

export type RemoveCalendarInput = {
	calendarId: string;
	destinationCalendarId?: string;
};

export type SetDefaultCalendarInput = {
	calendarId: string;
};

type CreateCalendarCommand = CreateCalendarInput & {
	provider: CalendarProvider;
};

type UpdateCalendarCommand = UpdateCalendarInput & {
	provider: CalendarProvider;
};

type RemoveCalendarCommand = RemoveCalendarInput & {
	provider: CalendarProvider;
};

type SetDefaultCalendarCommand = SetDefaultCalendarInput & {
	provider: CalendarProvider;
};

export type DeleteCalendarEventInput = {
	calendarId: string;
	providerEventId: string;
	recurrenceId?: string;
	recurrenceIsAllDay?: boolean;
};

export type RemoveCalendarEventInput = DeleteCalendarEventInput;

type UpdateCalendarEventCommand = UpdateCalendarEventInput & {
	provider: CalendarProvider;
};

type DeleteCalendarEventCommand = DeleteCalendarEventInput & {
	provider: CalendarProvider;
};

type RemoveCalendarEventCommand = DeleteCalendarEventCommand;

export type CalendarProviderAdapter = {
	createCalendar: (input: CreateCalendarInput) => Promise<{ id: string }>;
	createEvent: (input: CalendarEventDetailsInput) => Promise<{ id: string }>;
	removeCalendar: (input: RemoveCalendarInput) => Promise<null>;
	deleteEvent: (input: DeleteCalendarEventInput) => Promise<null>;
	listEvents: (
		input: CalendarProviderReadInput,
	) => Promise<CalendarEventsFetchResult>;
	removeEvent: (input: RemoveCalendarEventInput) => Promise<null>;
	setDefaultCalendar: (input: SetDefaultCalendarInput) => Promise<null>;
	updateCalendar: (input: UpdateCalendarInput) => Promise<null>;
	updateEvent: (input: UpdateCalendarEventInput) => Promise<null>;
};

export type CalendarProviderAdapters = Record<
	CalendarProvider,
	CalendarProviderAdapter
>;

export type CalendarProviderVisibility = Record<CalendarProvider, boolean>;

const CALENDAR_PROVIDERS = ["google", "yandex"] as const;

const normalizeCalendarEventDetails = (
	input: CalendarEventDetailsInput,
): CalendarEventDetailsInput => {
	const title = input.title.trim();

	if (!title) {
		throw new ConvexError({
			code: "CALENDAR_EVENT_TITLE_REQUIRED",
			message: "Event title is required.",
		});
	}

	const normalizedGuests = input.guests.map(normalizeEmail);

	if (normalizedGuests.some((guest) => guest === null)) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_EVENT_GUEST",
			message: "One or more guest email addresses are invalid.",
		});
	}

	const guests = Array.from(
		new Set(normalizedGuests.filter((guest) => guest !== null)),
	);

	if (input.time.kind === "all_day") {
		if (
			!isCalendarDateValue(input.time.startDate) ||
			!isCalendarDateValue(input.time.endDate) ||
			input.time.endDate <= input.time.startDate
		) {
			throw new ConvexError({
				code: "INVALID_CALENDAR_EVENT_TIME",
				message: "Event dates are invalid.",
			});
		}
	} else {
		const startAt = new Date(input.time.startAt).getTime();
		const endAt = new Date(input.time.endAt).getTime();

		if (
			!Number.isFinite(startAt) ||
			!Number.isFinite(endAt) ||
			endAt <= startAt
		) {
			throw new ConvexError({
				code: "INVALID_CALENDAR_EVENT_TIME",
				message: "Event time is invalid.",
			});
		}
	}

	const recurrence = input.recurrence
		? normalizeCalendarEventRecurrenceInput({
				recurrence: input.recurrence,
				time: input.time,
			})
		: undefined;

	return {
		calendarId: input.calendarId,
		description: input.description?.trim() || undefined,
		guests,
		location: input.location?.trim() || undefined,
		recurrence,
		time: input.time,
		title,
	};
};

const normalizeUpdateCalendarEventCommand = (
	input: UpdateCalendarEventCommand,
): UpdateCalendarEventCommand => {
	const normalized = normalizeCalendarEventDetails({
		calendarId: input.calendarId,
		description: input.description,
		guests: input.guests,
		location: input.location,
		time: input.time,
		title: input.title,
	});
	const providerEventId = input.providerEventId.trim();
	const destinationCalendarId = input.destinationCalendarId.trim();
	const seriesProviderEventId =
		input.seriesProviderEventId?.trim() || undefined;

	if (!providerEventId || !destinationCalendarId) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_EVENT_ID",
			message: "The calendar event or destination identifier is invalid.",
		});
	}

	return {
		calendarId: normalized.calendarId,
		destinationCalendarId,
		description: normalized.description,
		guests: normalized.guests,
		location: normalized.location,
		provider: input.provider,
		providerEventId,
		recurrenceId: input.recurrenceId,
		recurrenceIsAllDay: input.recurrenceIsAllDay,
		seriesProviderEventId,
		time: normalized.time,
		title: normalized.title,
	};
};

const normalizeCalendarDetails = (
	input: CreateCalendarInput,
): CreateCalendarInput => {
	const name = input.name.trim();
	const color = input.color.trim().toLowerCase();

	if (!name || name.length > 128) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_NAME",
			message: "Calendar name must contain between 1 and 128 characters.",
		});
	}

	if (!/^#[0-9a-f]{6}$/u.test(color)) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_COLOR",
			message: "Calendar color is invalid.",
		});
	}

	return { color, name };
};

const requireCalendarId = (calendarId: string) => {
	const normalized = calendarId.trim();
	if (!normalized) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_ID",
			message: "Calendar identifier is invalid.",
		});
	}
	return normalized;
};

const requireProviderEventId = (value: string) => {
	const providerEventId = value.trim();
	if (!providerEventId) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_EVENT_ID",
			message: "The calendar event identifier is invalid.",
		});
	}
	return providerEventId;
};

const dedupeUpcomingEvents = (events: UpcomingCalendarEvent[]) => {
	const uniqueEvents = new Map<string, UpcomingCalendarEvent>();

	for (const event of events) {
		const key = `${event.provider}:${event.id}:${event.startAt}`;

		if (!uniqueEvents.has(key)) {
			uniqueEvents.set(key, event);
		}
	}

	return Array.from(uniqueEvents.values());
};

const dedupeCalendarSources = (calendars: CalendarSource[]) => {
	const uniqueCalendars = new Map<string, CalendarSource>();

	for (const calendar of calendars) {
		const key = `${calendar.provider}:${calendar.id}`;

		if (!uniqueCalendars.has(key)) {
			uniqueCalendars.set(key, calendar);
		}
	}

	return Array.from(uniqueCalendars.values()).sort((left, right) =>
		left.name.localeCompare(right.name),
	);
};

const mergeCalendarEventResults = (
	results: CalendarEventsFetchResult[],
): CalendarEventsFetchResult => ({
	calendars: dedupeCalendarSources(
		results.flatMap((result) => result.calendars),
	),
	connectedCalendarCount: results.reduce(
		(total, result) => total + result.connectedCalendarCount,
		0,
	),
	events: dedupeUpcomingEvents(results.flatMap((result) => result.events)),
});

export const createCalendarProviderModule = ({
	adapters,
}: {
	adapters: CalendarProviderAdapters;
}) => {
	return {
		createCalendar: async (command: CreateCalendarCommand) => {
			return await adapters[command.provider].createCalendar(
				normalizeCalendarDetails(command),
			);
		},
		createEvent: async (command: CreateCalendarEventInput) => {
			const { provider, ...input } = command;
			return await adapters[provider].createEvent(
				normalizeCalendarEventDetails(input),
			);
		},
		removeCalendar: async (command: RemoveCalendarCommand) => {
			const calendarId = requireCalendarId(command.calendarId);
			const destinationCalendarId = command.destinationCalendarId?.trim();
			if (
				command.destinationCalendarId !== undefined &&
				!destinationCalendarId
			) {
				throw new ConvexError({
					code: "INVALID_CALENDAR_ID",
					message: "Calendar identifier is invalid.",
				});
			}
			return await adapters[command.provider].removeCalendar({
				calendarId,
				destinationCalendarId,
			});
		},
		deleteEvent: async (command: DeleteCalendarEventCommand) => {
			const { provider, ...input } = command;
			return await adapters[provider].deleteEvent({
				...input,
				providerEventId: requireProviderEventId(input.providerEventId),
			});
		},
		listWorkspaceEvents: async ({
			visibility,
			...input
		}: CalendarProviderReadInput & {
			visibility: CalendarProviderVisibility;
		}) => {
			const enabledProviders = CALENDAR_PROVIDERS.filter(
				(provider) => visibility[provider],
			);

			if (enabledProviders.length === 0) {
				return mergeCalendarEventResults([]);
			}

			const results = await Promise.all(
				enabledProviders.map(
					async (provider) => await adapters[provider].listEvents(input),
				),
			);

			return mergeCalendarEventResults(results);
		},
		removeEvent: async (command: RemoveCalendarEventCommand) => {
			const { provider, ...input } = command;
			return await adapters[provider].removeEvent({
				...input,
				providerEventId: requireProviderEventId(input.providerEventId),
			});
		},
		setDefaultCalendar: async (command: SetDefaultCalendarCommand) =>
			await adapters[command.provider].setDefaultCalendar({
				calendarId: requireCalendarId(command.calendarId),
			}),
		updateCalendar: async (command: UpdateCalendarCommand) => {
			const calendarId = requireCalendarId(command.calendarId);
			const details = normalizeCalendarDetails(command);
			return await adapters[command.provider].updateCalendar({
				...details,
				calendarId,
			});
		},
		updateEvent: async (command: UpdateCalendarEventCommand) => {
			const { provider, ...input } =
				normalizeUpdateCalendarEventCommand(command);
			return await adapters[provider].updateEvent(input);
		},
	};
};
