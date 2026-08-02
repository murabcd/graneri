import type { FunctionReturnType } from "convex/server";
import { z } from "zod";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import { calendarEventSchema } from "@/components/calendar/calendar-event-schema";
import type { CalendarSource } from "@/components/calendar/calendar-view-model";
import { createSessionSnapshotCache } from "@/lib/session-snapshot-cache";
import type { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const CALENDAR_SNAPSHOT_STORAGE_KEY = "graneri:calendar-snapshots:v2";
const MAX_CALENDAR_SNAPSHOTS = 14;

const calendarSourceSchema: z.ZodType<CalendarSource> = z.object({
	canCreateEvents: z.boolean(),
	canEdit: z.boolean(),
	canSetDefault: z.boolean(),
	color: z.string(),
	id: z.string(),
	name: z.string(),
	provider: z.enum(["google", "yandex"]),
	removalMode: z.enum(["delete", "none", "unsubscribe"]),
	requiresEventMove: z.boolean(),
});

const agendaSnapshotEntrySchema = z.object({
	accountId: z.string(),
	cachedAt: z.number(),
	calendars: z.array(calendarSourceSchema),
	events: z.array(calendarEventSchema),
	key: z.string(),
	kind: z.literal("agenda"),
	sourceKey: z.string(),
	timeMax: z.string(),
	timeMin: z.string(),
	workspaceId: z.string(),
});

const upcomingSnapshotEntrySchema = z.object({
	accountId: z.string(),
	cachedAt: z.number(),
	connectedCalendarCount: z.number(),
	dayKey: z.string(),
	events: z.array(calendarEventSchema),
	key: z.string(),
	kind: z.literal("upcoming"),
	sourceKey: z.string(),
	workspaceId: z.string(),
});

const calendarSnapshotEntrySchema = z.discriminatedUnion("kind", [
	agendaSnapshotEntrySchema,
	upcomingSnapshotEntrySchema,
]);

const calendarSnapshotStorageSchema = z.object({
	snapshots: z.array(calendarSnapshotEntrySchema),
	version: z.literal(2),
});

export type CalendarRequestWindow = {
	timeMax: string;
	timeMin: string;
};

export type CalendarSourceState = {
	showGoogleCalendar: boolean;
	showYandexCalendar: boolean;
	yandexConnectionSourceId: string | null;
	yandexConnectionStatus: string | null;
};

export type CalendarAgendaScope = {
	accountId: string;
	requestWindow: CalendarRequestWindow;
	sourceKey: string;
	workspaceId: Id<"workspaces">;
};

export type UpcomingCalendarScope = {
	accountId: string;
	dayKey: string;
	sourceKey: string;
	workspaceId: Id<"workspaces">;
};

export type CalendarAgendaSnapshot = {
	calendars: CalendarSource[];
	events: UpcomingCalendarEvent[];
};

export type UpcomingCalendarSnapshot = {
	connectedCalendarCount: number;
	events: UpcomingCalendarEvent[];
};

type CalendarSnapshotEntry = z.infer<typeof calendarSnapshotEntrySchema>;
type AgendaSnapshotEntry = z.infer<typeof agendaSnapshotEntrySchema>;
type UpcomingSnapshotEntry = z.infer<typeof upcomingSnapshotEntrySchema>;
type CalendarEventsResponse = FunctionReturnType<
	typeof api.calendar.listCalendarEvents
>;
type UpcomingEventsResponse = FunctionReturnType<
	typeof api.calendar.listUpcomingCalendarEvents
>;
type CalendarSnapshotListener = () => void;

type CalendarSnapshotLoadResult<Snapshot> =
	| { status: "not_connected" }
	| { status: "obsolete" }
	| { snapshot: Snapshot; status: "ready" };

const snapshotCache = createSessionSnapshotCache<CalendarSnapshotEntry>({
	deserialize: (rawValue) => {
		const parsedValue = calendarSnapshotStorageSchema.safeParse(
			JSON.parse(rawValue),
		);
		return parsedValue.success ? parsedValue.data.snapshots : null;
	},
	maxEntries: MAX_CALENDAR_SNAPSHOTS,
	serialize: (snapshots) => JSON.stringify({ snapshots, version: 2 }),
	storageKey: CALENDAR_SNAPSHOT_STORAGE_KEY,
});

const workspaceGenerations = new Map<string, number>();
const workspaceSourceKeys = new Map<string, string>();
const workspaceListeners = new Map<string, Set<CalendarSnapshotListener>>();
const agendaRequests = new Map<
	string,
	Promise<CalendarSnapshotLoadResult<CalendarAgendaSnapshot>>
>();
const upcomingRequests = new Map<
	string,
	Promise<CalendarSnapshotLoadResult<UpcomingCalendarSnapshot>>
>();

const getWorkspaceGeneration = (workspaceId: string | null) =>
	workspaceId ? (workspaceGenerations.get(workspaceId) ?? 0) : 0;

const subscribeToWorkspace = (
	workspaceId: string | null,
	listener: CalendarSnapshotListener,
) => {
	if (!workspaceId) {
		return () => undefined;
	}

	const listeners =
		workspaceListeners.get(workspaceId) ?? new Set<CalendarSnapshotListener>();
	listeners.add(listener);
	workspaceListeners.set(workspaceId, listeners);

	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			workspaceListeners.delete(workspaceId);
		}
	};
};

const createAgendaScopeKey = (scope: CalendarAgendaScope) =>
	JSON.stringify({
		accountId: scope.accountId,
		kind: "agenda",
		sourceKey: scope.sourceKey,
		timeMax: scope.requestWindow.timeMax,
		timeMin: scope.requestWindow.timeMin,
		workspaceId: scope.workspaceId,
	});

const createUpcomingScopeKey = (scope: UpcomingCalendarScope) =>
	JSON.stringify({
		accountId: scope.accountId,
		dayKey: scope.dayKey,
		kind: "upcoming",
		sourceKey: scope.sourceKey,
		workspaceId: scope.workspaceId,
	});

const toAgendaSnapshot = (
	entry: AgendaSnapshotEntry,
): CalendarAgendaSnapshot => ({
	calendars: entry.calendars,
	events: entry.events,
});

const toUpcomingSnapshot = (
	entry: UpcomingSnapshotEntry,
): UpcomingCalendarSnapshot => ({
	connectedCalendarCount: entry.connectedCalendarCount,
	events: entry.events,
});

const isCurrentGeneration = (workspaceId: string, generation: number) =>
	getWorkspaceGeneration(workspaceId) === generation;

const loadSnapshot = <Response, Snapshot>({
	activeRequests,
	commit,
	generation,
	load,
	scopeKey,
	workspaceId,
}: {
	activeRequests: Map<string, Promise<CalendarSnapshotLoadResult<Snapshot>>>;
	commit: (response: Response) => CalendarSnapshotLoadResult<Snapshot>;
	generation: number;
	load: () => Promise<Response>;
	scopeKey: string;
	workspaceId: string;
}) => {
	if (!isCurrentGeneration(workspaceId, generation)) {
		return Promise.resolve({ status: "obsolete" } as const);
	}

	const requestKey = `${scopeKey}:${generation}`;
	const activeRequest = activeRequests.get(requestKey);
	if (activeRequest) {
		return activeRequest;
	}

	const request = load()
		.then((response) =>
			isCurrentGeneration(workspaceId, generation)
				? commit(response)
				: ({ status: "obsolete" } as const),
		)
		.catch((error: unknown) => {
			if (!isCurrentGeneration(workspaceId, generation)) {
				return { status: "obsolete" } as const;
			}
			throw error;
		})
		.finally(() => {
			activeRequests.delete(requestKey);
		});
	activeRequests.set(requestKey, request);
	return request;
};

export const createCalendarSourceKey = (state: CalendarSourceState) =>
	JSON.stringify(state);

export const readCalendarAgendaSnapshot = (
	scope: CalendarAgendaScope,
): CalendarAgendaSnapshot | null => {
	const entry = snapshotCache.get(createAgendaScopeKey(scope));
	return entry?.kind === "agenda" ? toAgendaSnapshot(entry) : null;
};

export const readUpcomingCalendarSnapshot = (
	scope: UpcomingCalendarScope,
): UpcomingCalendarSnapshot | null => {
	const entry = snapshotCache.get(createUpcomingScopeKey(scope));
	return entry?.kind === "upcoming" ? toUpcomingSnapshot(entry) : null;
};

export const readRecentUpcomingCalendarSnapshot = ({
	accountId,
	dayKey,
	workspaceId,
}: {
	accountId: string;
	dayKey: string;
	workspaceId: Id<"workspaces">;
}): UpcomingCalendarSnapshot | null => {
	let latestSnapshot: UpcomingSnapshotEntry | null = null;

	for (const entry of snapshotCache.values()) {
		if (
			entry.kind !== "upcoming" ||
			entry.accountId !== accountId ||
			entry.dayKey !== dayKey ||
			entry.workspaceId !== workspaceId ||
			(latestSnapshot && latestSnapshot.cachedAt > entry.cachedAt)
		) {
			continue;
		}

		latestSnapshot = entry;
	}

	return latestSnapshot ? toUpcomingSnapshot(latestSnapshot) : null;
};

export const loadCalendarAgendaSnapshot = ({
	generation,
	load,
	scope,
}: {
	generation: number;
	load: () => Promise<CalendarEventsResponse>;
	scope: CalendarAgendaScope;
}) => {
	const scopeKey = createAgendaScopeKey(scope);
	return loadSnapshot({
		activeRequests: agendaRequests,
		commit: (result): CalendarSnapshotLoadResult<CalendarAgendaSnapshot> => {
			if (result.status === "not_connected") {
				snapshotCache.delete(scopeKey);
				return { status: "not_connected" };
			}

			const snapshot: CalendarAgendaSnapshot = {
				calendars: result.calendars,
				events: result.events,
			};
			snapshotCache.set({
				...scope.requestWindow,
				...snapshot,
				accountId: scope.accountId,
				cachedAt: Date.now(),
				key: scopeKey,
				kind: "agenda",
				sourceKey: scope.sourceKey,
				workspaceId: scope.workspaceId,
			});
			return { snapshot, status: "ready" };
		},
		generation,
		load,
		scopeKey,
		workspaceId: scope.workspaceId,
	});
};

export const loadUpcomingCalendarSnapshot = ({
	generation,
	load,
	scope,
}: {
	generation: number;
	load: () => Promise<UpcomingEventsResponse>;
	scope: UpcomingCalendarScope;
}) => {
	const scopeKey = createUpcomingScopeKey(scope);
	return loadSnapshot({
		activeRequests: upcomingRequests,
		commit: (result): CalendarSnapshotLoadResult<UpcomingCalendarSnapshot> => {
			if (result.status === "not_connected") {
				snapshotCache.delete(scopeKey);
				return { status: "not_connected" };
			}

			const snapshot: UpcomingCalendarSnapshot = {
				connectedCalendarCount: result.connectedCalendarCount,
				events: result.events,
			};
			snapshotCache.set({
				...snapshot,
				accountId: scope.accountId,
				cachedAt: Date.now(),
				dayKey: scope.dayKey,
				key: scopeKey,
				kind: "upcoming",
				sourceKey: scope.sourceKey,
				workspaceId: scope.workspaceId,
			});
			return { snapshot, status: "ready" };
		},
		generation,
		load,
		scopeKey,
		workspaceId: scope.workspaceId,
	});
};

export const invalidateCalendarSnapshots = (workspaceId: string) => {
	workspaceGenerations.set(
		workspaceId,
		getWorkspaceGeneration(workspaceId) + 1,
	);

	for (const entry of snapshotCache.values()) {
		if (entry.workspaceId === workspaceId) {
			snapshotCache.delete(entry.key);
		}
	}

	for (const listener of workspaceListeners.get(workspaceId) ?? []) {
		listener();
	}
};

export const observeCalendarSnapshotSource = (
	workspaceId: string,
	sourceKey: string,
) => {
	const previousSourceKey = workspaceSourceKeys.get(workspaceId);
	workspaceSourceKeys.set(workspaceId, sourceKey);
	if (previousSourceKey && previousSourceKey !== sourceKey) {
		invalidateCalendarSnapshots(workspaceId);
	}
};

export const readCalendarSnapshotGeneration = (workspaceId: string | null) =>
	getWorkspaceGeneration(workspaceId);

export const subscribeToCalendarSnapshotGeneration = subscribeToWorkspace;
