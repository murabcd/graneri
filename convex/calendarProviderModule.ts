import type {
	CalendarEventDetailsInput,
	CalendarEventsFetchResult,
	CalendarProvider,
	CalendarSource,
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

export type DeleteCalendarEventInput = {
	calendarId: string;
	providerEventId: string;
	recurrenceId?: string;
	recurrenceIsAllDay?: boolean;
};

export type CalendarProviderAdapter = {
	createCalendar: (input: CreateCalendarInput) => Promise<{ id: string }>;
	createEvent: (input: CalendarEventDetailsInput) => Promise<{ id: string }>;
	deleteEvent: (input: DeleteCalendarEventInput) => Promise<null>;
	listEvents: (
		input: CalendarProviderReadInput,
	) => Promise<CalendarEventsFetchResult>;
	updateEvent: (input: UpdateCalendarEventInput) => Promise<null>;
};

export type CalendarProviderAdapters = Record<
	CalendarProvider,
	CalendarProviderAdapter
>;

export type CalendarProviderVisibility = Record<CalendarProvider, boolean>;

const CALENDAR_PROVIDERS = ["google", "yandex"] as const;

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
		createCalendar: async (
			provider: CalendarProvider,
			input: CreateCalendarInput,
		) => await adapters[provider].createCalendar(input),
		createEvent: async (
			provider: CalendarProvider,
			input: CalendarEventDetailsInput,
		) => await adapters[provider].createEvent(input),
		deleteEvent: async (
			provider: CalendarProvider,
			input: DeleteCalendarEventInput,
		) => await adapters[provider].deleteEvent(input),
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
		updateEvent: async (
			provider: CalendarProvider,
			input: UpdateCalendarEventInput,
		) => await adapters[provider].updateEvent(input),
	};
};
