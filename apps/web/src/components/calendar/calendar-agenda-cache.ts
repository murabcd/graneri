import type { FunctionReturnType } from "convex/server";
import { z } from "zod";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import type { CalendarSource } from "@/components/calendar/calendar-view-model";
import type { api } from "../../../../../convex/_generated/api";

const CALENDAR_AGENDA_CACHE_STORAGE_KEY = "graneri:calendar-agenda-cache:v6";
const MAX_CACHED_AGENDAS = 6;

const calendarSourceSchema: z.ZodType<CalendarSource> = z.object({
	canCreateEvents: z.boolean(),
	color: z.string(),
	id: z.string(),
	name: z.string(),
	provider: z.enum(["google", "yandex"]),
});

const calendarEventSchema: z.ZodType<UpcomingCalendarEvent> = z.object({
	id: z.string(),
	calendarId: z.string(),
	calendarName: z.string(),
	description: z.string().optional(),
	title: z.string(),
	startAt: z.string(),
	endAt: z.string(),
	isAllDay: z.boolean(),
	isMeeting: z.boolean(),
	isRecurring: z.boolean(),
	htmlLink: z.string().optional(),
	meetingUrl: z.string().optional(),
	location: z.string().optional(),
	provider: z.enum(["google", "yandex"]),
	providerEventId: z.string(),
	recurrenceId: z.string().optional(),
});

const cachedAgendaSchema = z.object({
	cachedAt: z.number(),
	key: z.string(),
	calendars: z.array(calendarSourceSchema),
	events: z.array(calendarEventSchema),
});

const calendarAgendaCacheSchema = z.object({
	version: z.literal(6),
	agendas: z.array(cachedAgendaSchema),
});

export type CalendarRequestWindow = {
	timeMax: string;
	timeMin: string;
};

type CalendarEventsResponse = FunctionReturnType<
	typeof api.calendar.listCalendarEvents
>;

export type CalendarAgendaSnapshot = {
	calendars: CalendarSource[];
	events: UpcomingCalendarEvent[];
};

type CachedCalendarAgenda = CalendarAgendaSnapshot & {
	cachedAt: number;
	key: string;
};

const memoryCache = new Map<string, CachedCalendarAgenda>();
const inFlightRequests = new Map<string, Promise<CalendarEventsResponse>>();
let storageHydrated = false;

const getCacheKey = (
	workspaceId: string,
	requestWindow: CalendarRequestWindow,
) => `${workspaceId}:${requestWindow.timeMin}:${requestWindow.timeMax}`;

const readStoredAgendas = () => {
	if (typeof window === "undefined") {
		return [];
	}

	try {
		const rawValue = window.sessionStorage.getItem(
			CALENDAR_AGENDA_CACHE_STORAGE_KEY,
		);

		if (!rawValue) {
			return [];
		}

		const parsedValue = calendarAgendaCacheSchema.safeParse(
			JSON.parse(rawValue),
		);
		return parsedValue.success ? parsedValue.data.agendas : [];
	} catch {
		return [];
	}
};

const hydrateMemoryCache = () => {
	if (storageHydrated) {
		return;
	}

	storageHydrated = true;
	for (const agenda of readStoredAgendas()) {
		memoryCache.set(agenda.key, agenda);
	}
};

const persistMemoryCache = () => {
	if (typeof window === "undefined") {
		return;
	}

	const agendas = Array.from(memoryCache.values())
		.sort((left, right) => right.cachedAt - left.cachedAt)
		.slice(0, MAX_CACHED_AGENDAS);

	memoryCache.clear();
	for (const agenda of agendas) {
		memoryCache.set(agenda.key, agenda);
	}

	try {
		window.sessionStorage.setItem(
			CALENDAR_AGENDA_CACHE_STORAGE_KEY,
			JSON.stringify({ version: 6, agendas }),
		);
	} catch {
		// The in-memory cache still preserves fast navigation for this app session.
	}
};

export const readCalendarAgendaSnapshot = (
	workspaceId: string,
	requestWindow: CalendarRequestWindow,
): CalendarAgendaSnapshot | null => {
	hydrateMemoryCache();
	const agenda = memoryCache.get(getCacheKey(workspaceId, requestWindow));

	if (!agenda) {
		return null;
	}

	return {
		calendars: agenda.calendars,
		events: agenda.events,
	};
};

export const writeCalendarAgendaSnapshot = (
	workspaceId: string,
	requestWindow: CalendarRequestWindow,
	snapshot: CalendarAgendaSnapshot,
) => {
	hydrateMemoryCache();
	const key = getCacheKey(workspaceId, requestWindow);
	memoryCache.set(key, {
		...snapshot,
		cachedAt: Date.now(),
		key,
	});
	persistMemoryCache();
};

export const removeCalendarAgendaSnapshot = (
	workspaceId: string,
	requestWindow: CalendarRequestWindow,
) => {
	hydrateMemoryCache();
	memoryCache.delete(getCacheKey(workspaceId, requestWindow));
	persistMemoryCache();
};

export const loadCalendarAgenda = (
	workspaceId: string,
	requestWindow: CalendarRequestWindow,
	load: () => Promise<CalendarEventsResponse>,
) => {
	const key = getCacheKey(workspaceId, requestWindow);
	const activeRequest = inFlightRequests.get(key);

	if (activeRequest) {
		return activeRequest;
	}

	const request = load().finally(() => {
		if (inFlightRequests.get(key) === request) {
			inFlightRequests.delete(key);
		}
	});
	inFlightRequests.set(key, request);
	return request;
};
