import { useAction, useQuery } from "convex/react";
import * as React from "react";
import type { UpcomingCalendarState } from "@/app/app-types";
import {
	syncDisconnectedDesktopTrayCalendar,
	syncErrorDesktopTrayCalendar,
	syncReadyDesktopTrayCalendar,
} from "@/app/desktop-tray-calendar-sync";
import { getDayWindowFromDayKey } from "@/app/location";
import {
	createUpcomingCalendarScopeKey,
	readRecentUpcomingCalendarSnapshot,
	readUpcomingCalendarSnapshot,
	removeUpcomingCalendarSnapshot,
	writeUpcomingCalendarSnapshot,
} from "@/app/upcoming-calendar-cache";
import { useCalendarRefreshRevision } from "@/components/calendar/calendar-refresh-signal";
import { logError } from "@/lib/logger";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type UpcomingCalendarSession = {
	scopeKey: string;
	state: UpcomingCalendarState;
};

export const useUpcomingCalendar = ({
	accountId,
	currentDayKey,
	isAuthenticated,
	workspaceId,
}: {
	accountId: string | null;
	currentDayKey: string;
	isAuthenticated: boolean;
	workspaceId: Id<"workspaces"> | null;
}) => {
	const queryArgs =
		accountId && isAuthenticated && workspaceId ? { workspaceId } : "skip";
	const calendarPreferences = useQuery(api.calendarPreferences.get, queryArgs);
	const yandexCalendarConnection = useQuery(
		api.appConnections.getYandexCalendar,
		queryArgs,
	);
	const listUpcomingEvents = useAction(api.calendar.listUpcomingCalendarEvents);
	const calendarRefreshRevision = useCalendarRefreshRevision(workspaceId);
	const [session, setSession] = React.useState<UpcomingCalendarSession | null>(
		null,
	);
	const requestIdRef = React.useRef(0);
	const scopeKey =
		accountId &&
		isAuthenticated &&
		workspaceId &&
		calendarPreferences !== undefined &&
		yandexCalendarConnection !== undefined
			? createUpcomingCalendarScopeKey({
					accountId,
					dayKey: currentDayKey,
					showGoogleCalendar: calendarPreferences.showGoogleCalendar,
					showYandexCalendar: calendarPreferences.showYandexCalendar,
					workspaceId,
					yandexConnectionSourceId: yandexCalendarConnection?.sourceId ?? null,
					yandexConnectionStatus: yandexCalendarConnection?.status ?? null,
				})
			: null;
	const refreshRequest = React.useMemo(
		() =>
			scopeKey
				? {
						revision: calendarRefreshRevision,
						scopeKey,
					}
				: null,
		[calendarRefreshRevision, scopeKey],
	);
	const cachedSnapshot = React.useMemo(() => {
		if (scopeKey) {
			return readUpcomingCalendarSnapshot(scopeKey);
		}

		if (accountId && workspaceId) {
			return readRecentUpcomingCalendarSnapshot({
				accountId,
				dayKey: currentDayKey,
				workspaceId,
			});
		}

		return null;
	}, [accountId, currentDayKey, scopeKey, workspaceId]);
	const state = React.useMemo<UpcomingCalendarState>(() => {
		if (scopeKey && session?.scopeKey === scopeKey) {
			return session.state;
		}

		if (cachedSnapshot) {
			return {
				status: "refreshing",
				events: cachedSnapshot.events,
			};
		}

		return accountId && workspaceId
			? { status: "checking", events: [] }
			: { status: "not_connected", events: [] };
	}, [accountId, cachedSnapshot, scopeKey, session, workspaceId]);

	const refresh = React.useEffectEvent(async (activeScopeKey: string) => {
		if (!workspaceId) {
			return;
		}

		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		const cached = readUpcomingCalendarSnapshot(activeScopeKey);

		if (cached) {
			setSession({
				scopeKey: activeScopeKey,
				state: {
					status: "refreshing",
					events: cached.events,
				},
			});
			syncReadyDesktopTrayCalendar(cached);
		} else {
			setSession({
				scopeKey: activeScopeKey,
				state: { status: "checking", events: [] },
			});
			syncDisconnectedDesktopTrayCalendar();
		}

		try {
			const result = await listUpcomingEvents({
				workspaceId,
				...getDayWindowFromDayKey(currentDayKey),
			});

			if (requestIdRef.current !== requestId) {
				return;
			}

			if (result.status === "not_connected") {
				removeUpcomingCalendarSnapshot(activeScopeKey);
				setSession({
					scopeKey: activeScopeKey,
					state: { status: "not_connected", events: [] },
				});
				syncDisconnectedDesktopTrayCalendar();
				return;
			}

			const nextSnapshot = {
				connectedCalendarCount: result.connectedCalendarCount,
				events: result.events,
			};
			writeUpcomingCalendarSnapshot(activeScopeKey, nextSnapshot);
			setSession({
				scopeKey: activeScopeKey,
				state: { status: "ready", events: result.events },
			});
			syncReadyDesktopTrayCalendar(nextSnapshot);
		} catch (error) {
			if (requestIdRef.current !== requestId) {
				return;
			}

			logError({
				event: "client.error",
				error,
				message: "Failed to load upcoming calendar events",
			});
			setSession((current) => ({
				scopeKey: activeScopeKey,
				state: {
					status: "error",
					events:
						current?.scopeKey === activeScopeKey ? current.state.events : [],
				},
			}));
			syncErrorDesktopTrayCalendar();
		}
	});

	React.useEffect(() => {
		if (!accountId || !workspaceId) {
			requestIdRef.current += 1;
			syncDisconnectedDesktopTrayCalendar();
			return;
		}

		if (!refreshRequest) {
			requestIdRef.current += 1;
			return;
		}

		void refresh(refreshRequest.scopeKey);
	}, [accountId, refreshRequest, workspaceId]);

	React.useEffect(() => {
		if (!scopeKey) {
			return;
		}

		const handleFocus = () => {
			void refresh(scopeKey);
		};

		window.addEventListener("focus", handleFocus);
		return () => window.removeEventListener("focus", handleFocus);
	}, [scopeKey]);

	return state;
};
