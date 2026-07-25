import { z } from "zod";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import { calendarEventSchema } from "@/components/calendar/calendar-event-schema";
import { createSessionSnapshotCache } from "@/lib/session-snapshot-cache";

const UPCOMING_CALENDAR_CACHE_STORAGE_KEY =
	"graneri:upcoming-calendar-cache:v1";
const MAX_CACHED_UPCOMING_CALENDARS = 8;

const cachedUpcomingCalendarSchema = z.object({
	cachedAt: z.number(),
	connectedCalendarCount: z.number(),
	events: z.array(calendarEventSchema),
	key: z.string(),
});

const upcomingCalendarScopeSchema = z.object({
	accountId: z.string(),
	dayKey: z.string(),
	showGoogleCalendar: z.boolean(),
	showYandexCalendar: z.boolean(),
	workspaceId: z.string(),
	yandexConnectionSourceId: z.string().nullable(),
	yandexConnectionStatus: z.string().nullable(),
});

type UpcomingCalendarScope = z.infer<typeof upcomingCalendarScopeSchema>;

const parseUpcomingCalendarScopeKey = (scopeKey: string) => {
	try {
		const parsedScope = upcomingCalendarScopeSchema.safeParse(
			JSON.parse(scopeKey),
		);
		return parsedScope.success ? parsedScope.data : null;
	} catch {
		return null;
	}
};

const upcomingCalendarCacheSchema = z.object({
	version: z.literal(1),
	calendars: z.array(cachedUpcomingCalendarSchema),
});

export type UpcomingCalendarSnapshot = {
	connectedCalendarCount: number;
	events: UpcomingCalendarEvent[];
};

type CachedUpcomingCalendar = UpcomingCalendarSnapshot & {
	cachedAt: number;
	key: string;
};

const upcomingCalendarCache =
	createSessionSnapshotCache<CachedUpcomingCalendar>({
		deserialize: (rawValue) => {
			const parsedValue = upcomingCalendarCacheSchema.safeParse(
				JSON.parse(rawValue),
			);
			return parsedValue.success ? parsedValue.data.calendars : null;
		},
		maxEntries: MAX_CACHED_UPCOMING_CALENDARS,
		serialize: (calendars) => JSON.stringify({ version: 1, calendars }),
		storageKey: UPCOMING_CALENDAR_CACHE_STORAGE_KEY,
	});

export const createUpcomingCalendarScopeKey = (scope: UpcomingCalendarScope) =>
	JSON.stringify(scope);

export const readUpcomingCalendarSnapshot = (
	scopeKey: string,
): UpcomingCalendarSnapshot | null => {
	const calendar = upcomingCalendarCache.get(scopeKey);
	if (!calendar) {
		return null;
	}

	return {
		connectedCalendarCount: calendar.connectedCalendarCount,
		events: calendar.events,
	};
};

export const readRecentUpcomingCalendarSnapshot = ({
	accountId,
	dayKey,
	workspaceId,
}: {
	accountId: string;
	dayKey: string;
	workspaceId: string;
}): UpcomingCalendarSnapshot | null => {
	let latestCalendar: CachedUpcomingCalendar | null = null;

	for (const calendar of upcomingCalendarCache.values()) {
		const parsedScope = parseUpcomingCalendarScopeKey(calendar.key);
		if (!parsedScope) {
			continue;
		}

		if (
			parsedScope.accountId !== accountId ||
			parsedScope.workspaceId !== workspaceId ||
			parsedScope.dayKey !== dayKey ||
			(latestCalendar && latestCalendar.cachedAt > calendar.cachedAt)
		) {
			continue;
		}

		latestCalendar = calendar;
	}

	return latestCalendar
		? {
				connectedCalendarCount: latestCalendar.connectedCalendarCount,
				events: latestCalendar.events,
			}
		: null;
};

export const writeUpcomingCalendarSnapshot = (
	scopeKey: string,
	snapshot: UpcomingCalendarSnapshot,
) => {
	upcomingCalendarCache.set({
		...snapshot,
		cachedAt: Date.now(),
		key: scopeKey,
	});
};

export const removeUpcomingCalendarSnapshot = (scopeKey: string) => {
	upcomingCalendarCache.delete(scopeKey);
};
