import type { FunctionReturnType } from "convex/server";
import { z } from "zod";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import { calendarEventSchema } from "@/components/calendar/calendar-event-schema";
import type { CalendarSource } from "@/components/calendar/calendar-view-model";
import { createSessionSnapshotCache } from "@/lib/session-snapshot-cache";
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

const inFlightRequests = new Map<string, Promise<CalendarEventsResponse>>();

const getCacheKey = (
	workspaceId: string,
	requestWindow: CalendarRequestWindow,
) => `${workspaceId}:${requestWindow.timeMin}:${requestWindow.timeMax}`;

const agendaCache = createSessionSnapshotCache<CachedCalendarAgenda>({
	deserialize: (rawValue) => {
		const parsedValue = calendarAgendaCacheSchema.safeParse(
			JSON.parse(rawValue),
		);
		return parsedValue.success ? parsedValue.data.agendas : null;
	},
	maxEntries: MAX_CACHED_AGENDAS,
	serialize: (agendas) => JSON.stringify({ version: 6, agendas }),
	storageKey: CALENDAR_AGENDA_CACHE_STORAGE_KEY,
});

export const readCalendarAgendaSnapshot = (
	workspaceId: string,
	requestWindow: CalendarRequestWindow,
): CalendarAgendaSnapshot | null => {
	const agenda = agendaCache.get(getCacheKey(workspaceId, requestWindow));

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
	const key = getCacheKey(workspaceId, requestWindow);
	agendaCache.set({
		...snapshot,
		cachedAt: Date.now(),
		key,
	});
};

export const removeCalendarAgendaSnapshot = (
	workspaceId: string,
	requestWindow: CalendarRequestWindow,
) => {
	agendaCache.delete(getCacheKey(workspaceId, requestWindow));
};

export const loadCalendarAgenda = (
	workspaceId: string,
	requestWindow: CalendarRequestWindow,
	requestRevision: number,
	load: () => Promise<CalendarEventsResponse>,
) => {
	const key = `${getCacheKey(workspaceId, requestWindow)}:${requestRevision}`;
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
