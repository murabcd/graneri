import { useAction } from "convex/react";
import * as React from "react";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import {
	type CalendarAgendaScope,
	type CalendarAgendaSnapshot,
	type CalendarRequestWindow,
	invalidateCalendarSnapshots,
	loadCalendarAgendaSnapshot,
	readCalendarAgendaSnapshot,
} from "@/components/calendar/calendar-snapshot-module";
import {
	type CalendarSource,
	getCalendarAgendaRange,
	toCalendarRequestWindow,
} from "@/components/calendar/calendar-view-model";
import { useCalendarMutations } from "@/components/calendar/use-calendar-mutations";
import { useCalendarSnapshotSource } from "@/components/calendar/use-calendar-snapshot-source";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { logError } from "@/lib/logger";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export type CalendarAgendaSessionState = {
	calendars: CalendarSource[];
	events: UpcomingCalendarEvent[];
	status: "error" | "loading" | "not_connected" | "ready";
	visibleWindow: CalendarRequestWindow;
	workspaceId: Id<"workspaces"> | null;
};

const getAdjacentRequestWindows = (
	requestWindow: CalendarRequestWindow,
): CalendarRequestWindow[] =>
	[-30, 30].map((dayCount) => {
		const start = new Date(requestWindow.timeMin);
		start.setDate(start.getDate() + dayCount);
		return toCalendarRequestWindow(getCalendarAgendaRange(start));
	});

const createInitialState = (
	scope: CalendarAgendaScope | null,
	requestWindow: CalendarRequestWindow,
): CalendarAgendaSessionState => {
	if (scope) {
		const snapshot = readCalendarAgendaSnapshot(scope);
		if (snapshot) {
			return {
				status: "ready",
				...snapshot,
				visibleWindow: requestWindow,
				workspaceId: scope.workspaceId,
			};
		}
	}

	return {
		status: "loading",
		calendars: [],
		events: [],
		visibleWindow: requestWindow,
		workspaceId: scope?.workspaceId ?? null,
	};
};

const createReadyState = (
	scope: CalendarAgendaScope,
	snapshot: CalendarAgendaSnapshot,
): CalendarAgendaSessionState => ({
	...snapshot,
	status: "ready",
	visibleWindow: scope.requestWindow,
	workspaceId: scope.workspaceId,
});

const retainAgendaState = (
	current: CalendarAgendaSessionState,
	{
		status,
		visibleWindow,
		workspaceId,
	}: {
		status: "error" | "loading";
		visibleWindow: CalendarRequestWindow;
		workspaceId: Id<"workspaces">;
	},
): CalendarAgendaSessionState =>
	current.workspaceId === workspaceId
		? { ...current, status }
		: {
				calendars: [],
				events: [],
				status,
				visibleWindow,
				workspaceId,
			};

export function useCalendarAgendaSession(accountId: string | null) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const listCalendarEvents = useAction(api.calendar.listCalendarEvents);
	const {
		createCalendar,
		createEvent,
		deleteCalendar,
		deleteEvent,
		removeEvent,
		setDefaultCalendar,
		updateCalendar,
		updateEvent,
	} = useCalendarMutations(activeWorkspaceId);
	const [requestWindow, setRequestWindow] = React.useState(() =>
		toCalendarRequestWindow(getCalendarAgendaRange(new Date())),
	);
	const { generation: calendarSnapshotGeneration, sourceKey } =
		useCalendarSnapshotSource({
			enabled: Boolean(accountId),
			workspaceId: activeWorkspaceId,
		});
	const agendaScope = React.useMemo<CalendarAgendaScope | null>(
		() =>
			accountId && activeWorkspaceId && sourceKey
				? {
						accountId,
						requestWindow,
						sourceKey,
						workspaceId: activeWorkspaceId,
					}
				: null,
		[accountId, activeWorkspaceId, requestWindow, sourceKey],
	);
	const [state, setState] = React.useState<CalendarAgendaSessionState>(() =>
		createInitialState(agendaScope, requestWindow),
	);
	const retry = React.useCallback(() => {
		if (activeWorkspaceId) {
			invalidateCalendarSnapshots(activeWorkspaceId);
		}
	}, [activeWorkspaceId]);
	const range = React.useMemo(
		() => ({
			start: new Date(state.visibleWindow.timeMin),
			end: new Date(state.visibleWindow.timeMax),
		}),
		[state.visibleWindow],
	);
	React.useEffect(() => {
		let cancelled = false;
		if (!accountId || !activeWorkspaceId) {
			setState({
				status: "not_connected",
				calendars: [],
				events: [],
				visibleWindow: requestWindow,
				workspaceId: null,
			});
			return;
		}
		if (!agendaScope) {
			setState((current) =>
				retainAgendaState(current, {
					status: "loading",
					visibleWindow: requestWindow,
					workspaceId: activeWorkspaceId,
				}),
			);
			return;
		}

		const targetScope = agendaScope;
		const targetWindow = targetScope.requestWindow;
		const loadAgenda = (scope: CalendarAgendaScope) =>
			loadCalendarAgendaSnapshot({
				generation: calendarSnapshotGeneration,
				load: () =>
					listCalendarEvents({
						workspaceId: activeWorkspaceId,
						...scope.requestWindow,
					}),
				scope,
			});
		const prefetchAdjacentAgendas = () => {
			for (const adjacentWindow of getAdjacentRequestWindows(targetWindow)) {
				const adjacentScope = {
					...targetScope,
					requestWindow: adjacentWindow,
				};
				if (readCalendarAgendaSnapshot(adjacentScope)) {
					continue;
				}

				void loadAgenda(adjacentScope).catch((error: unknown) => {
					logError({
						event: "client.error",
						error,
						message: "Failed to prefetch adjacent calendar view",
					});
				});
			}
		};
		const snapshot = readCalendarAgendaSnapshot(targetScope);
		if (snapshot) {
			setState(createReadyState(targetScope, snapshot));
			prefetchAdjacentAgendas();
		} else {
			setState((current) =>
				retainAgendaState(current, {
					status: "loading",
					visibleWindow: targetWindow,
					workspaceId: activeWorkspaceId,
				}),
			);
		}

		void loadAgenda(targetScope)
			.then((result) => {
				if (cancelled || result.status === "obsolete") {
					return;
				}

				if (result.status === "not_connected") {
					setState({
						status: "not_connected",
						calendars: [],
						events: [],
						visibleWindow: targetWindow,
						workspaceId: activeWorkspaceId,
					});
					return;
				}

				setState(createReadyState(targetScope, result.snapshot));
				if (!snapshot) {
					prefetchAdjacentAgendas();
				}
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}

				logError({
					event: "client.error",
					error,
					message: "Failed to load calendar view",
				});
				setState((current) =>
					retainAgendaState(current, {
						status: "error",
						visibleWindow: targetWindow,
						workspaceId: activeWorkspaceId,
					}),
				);
			});

		return () => {
			cancelled = true;
		};
	}, [
		accountId,
		activeWorkspaceId,
		agendaScope,
		calendarSnapshotGeneration,
		listCalendarEvents,
		requestWindow,
	]);

	const setAgendaStart = React.useCallback(
		(date: Date) => {
			const nextRequestWindow = toCalendarRequestWindow(
				getCalendarAgendaRange(date),
			);

			if (
				nextRequestWindow.timeMin === requestWindow.timeMin &&
				nextRequestWindow.timeMax === requestWindow.timeMax
			) {
				return;
			}

			const nextScope =
				accountId && activeWorkspaceId && sourceKey
					? {
							accountId,
							requestWindow: nextRequestWindow,
							sourceKey,
							workspaceId: activeWorkspaceId,
						}
					: null;
			const snapshot = nextScope ? readCalendarAgendaSnapshot(nextScope) : null;
			if (snapshot && nextScope) {
				setState(createReadyState(nextScope, snapshot));
			} else {
				setState((current) =>
					activeWorkspaceId
						? retainAgendaState(current, {
								status: "loading",
								visibleWindow: nextRequestWindow,
								workspaceId: activeWorkspaceId,
							})
						: {
								calendars: [],
								events: [],
								status: "loading",
								visibleWindow: nextRequestWindow,
								workspaceId: null,
							},
				);
			}
			setRequestWindow(nextRequestWindow);
		},
		[accountId, activeWorkspaceId, requestWindow, sourceKey],
	);
	const shiftRange = React.useCallback(
		(dayCount: number) => {
			const next = new Date(requestWindow.timeMin);
			next.setDate(next.getDate() + dayCount);
			setAgendaStart(next);
		},
		[requestWindow.timeMin, setAgendaStart],
	);

	return {
		activeWorkspaceId,
		createCalendar,
		createEvent,
		deleteCalendar,
		deleteEvent,
		removeEvent,
		setDefaultCalendar,
		range,
		retry,
		setAgendaStart,
		shiftRange,
		state,
		updateCalendar,
		updateEvent,
	};
}
