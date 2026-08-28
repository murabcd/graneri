import { useAction } from "convex/react";
import * as React from "react";
import type { UpcomingCalendarState } from "@/app/app-types";
import {
	syncDisconnectedDesktopTrayCalendar,
	syncErrorDesktopTrayCalendar,
	syncReadyDesktopTrayCalendar,
} from "@/app/desktop-tray-calendar-sync";
import { getDayWindowFromDayKey } from "@/app/location";
import {
	loadUpcomingCalendarSnapshot,
	readRecentUpcomingCalendarSnapshot,
	readUpcomingCalendarSnapshot,
	type UpcomingCalendarScope,
	type UpcomingCalendarSnapshot,
} from "@/components/calendar/calendar-snapshot-module";
import { useCalendarSnapshotSource } from "@/components/calendar/use-calendar-snapshot-source";
import { logError } from "@/lib/logger";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type UpcomingCalendarSession = {
	scope: UpcomingCalendarScope;
	snapshot: UpcomingCalendarSnapshot | null;
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
	const listUpcomingEvents = useAction(api.calendar.listUpcomingCalendarEvents);
	const [session, setSession] = React.useState<UpcomingCalendarSession | null>(
		null,
	);
	const requestIdRef = React.useRef(0);
	const { generation: calendarSnapshotGeneration, sourceKey } =
		useCalendarSnapshotSource({
			enabled: Boolean(accountId && isAuthenticated),
			workspaceId,
		});
	const scope = React.useMemo<UpcomingCalendarScope | null>(
		() =>
			accountId && isAuthenticated && workspaceId && sourceKey
				? {
						accountId,
						dayKey: currentDayKey,
						sourceKey,
						workspaceId,
					}
				: null,
		[accountId, currentDayKey, isAuthenticated, sourceKey, workspaceId],
	);
	const cachedSnapshot = React.useMemo(() => {
		if (scope) {
			return readUpcomingCalendarSnapshot(scope);
		}

		if (accountId && workspaceId) {
			return readRecentUpcomingCalendarSnapshot({
				accountId,
				dayKey: currentDayKey,
				workspaceId,
			});
		}

		return null;
	}, [accountId, currentDayKey, scope, workspaceId]);
	const state = React.useMemo<UpcomingCalendarState>(() => {
		if (scope && session?.scope === scope) {
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
	}, [accountId, cachedSnapshot, scope, session, workspaceId]);

	const refresh = React.useEffectEvent(
		async (
			activeScope: UpcomingCalendarScope,
			activeWorkspaceId: Id<"workspaces">,
			generation: number,
		) => {
			const requestId = requestIdRef.current + 1;
			requestIdRef.current = requestId;
			const cached = readUpcomingCalendarSnapshot(activeScope);
			const previousSnapshot =
				session?.scope.accountId === activeScope.accountId &&
				session.scope.dayKey === activeScope.dayKey &&
				session.scope.workspaceId === activeScope.workspaceId
					? session.snapshot
					: null;
			const retainedSnapshot =
				cached ??
				previousSnapshot ??
				readRecentUpcomingCalendarSnapshot({
					accountId: activeScope.accountId,
					dayKey: activeScope.dayKey,
					workspaceId: activeScope.workspaceId,
				});

			if (retainedSnapshot) {
				setSession({
					scope: activeScope,
					snapshot: retainedSnapshot,
					state: {
						status: "refreshing",
						events: retainedSnapshot.events,
					},
				});
				syncReadyDesktopTrayCalendar(retainedSnapshot);
			} else {
				setSession({
					scope: activeScope,
					snapshot: null,
					state: { status: "checking", events: [] },
				});
				syncDisconnectedDesktopTrayCalendar();
			}

			try {
				const result = await loadUpcomingCalendarSnapshot({
					generation,
					load: () =>
						listUpcomingEvents({
							workspaceId: activeWorkspaceId,
							...getDayWindowFromDayKey(activeScope.dayKey),
						}),
					scope: activeScope,
				});

				if (
					requestIdRef.current !== requestId ||
					result.status === "obsolete"
				) {
					return;
				}

				if (result.status === "not_connected") {
					setSession({
						scope: activeScope,
						snapshot: null,
						state: { status: "not_connected", events: [] },
					});
					syncDisconnectedDesktopTrayCalendar();
					return;
				}
				if (result.status === "unavailable") {
					setSession({
						scope: activeScope,
						snapshot: retainedSnapshot,
						state: {
							status: "error",
							events: retainedSnapshot?.events ?? [],
						},
					});
					if (retainedSnapshot) {
						syncReadyDesktopTrayCalendar(retainedSnapshot);
					} else {
						syncErrorDesktopTrayCalendar();
					}
					return;
				}

				setSession({
					scope: activeScope,
					snapshot: result.snapshot,
					state: { status: "ready", events: result.snapshot.events },
				});
				syncReadyDesktopTrayCalendar(result.snapshot);
			} catch (error) {
				if (requestIdRef.current !== requestId) {
					return;
				}

				logError({
					event: "client.error",
					error,
					message: "Failed to load upcoming calendar events",
				});
				setSession({
					scope: activeScope,
					snapshot: retainedSnapshot,
					state: {
						status: "error",
						events: retainedSnapshot?.events ?? [],
					},
				});
				if (retainedSnapshot) {
					syncReadyDesktopTrayCalendar(retainedSnapshot);
				} else {
					syncErrorDesktopTrayCalendar();
				}
			}
		},
	);

	React.useEffect(() => {
		if (!accountId || !workspaceId) {
			requestIdRef.current += 1;
			syncDisconnectedDesktopTrayCalendar();
			return;
		}

		if (!scope) {
			requestIdRef.current += 1;
			return;
		}

		void refresh(scope, workspaceId, calendarSnapshotGeneration);
	}, [accountId, calendarSnapshotGeneration, scope, workspaceId]);

	React.useEffect(() => {
		if (!scope || !workspaceId) {
			return;
		}

		const handleFocus = () => {
			void refresh(scope, workspaceId, calendarSnapshotGeneration);
		};

		window.addEventListener("focus", handleFocus);
		return () => window.removeEventListener("focus", handleFocus);
	}, [calendarSnapshotGeneration, scope, workspaceId]);

	return state;
};
