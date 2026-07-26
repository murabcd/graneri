import * as React from "react";

type CalendarRefreshListener = () => void;

const revisions = new Map<string, number>();
const listeners = new Map<string, Set<CalendarRefreshListener>>();

const getCalendarRefreshRevision = (workspaceId: string | null) =>
	workspaceId ? (revisions.get(workspaceId) ?? 0) : 0;

const subscribeToCalendarRefresh = (
	workspaceId: string | null,
	listener: CalendarRefreshListener,
) => {
	if (!workspaceId) {
		return () => undefined;
	}

	const workspaceListeners =
		listeners.get(workspaceId) ?? new Set<CalendarRefreshListener>();
	workspaceListeners.add(listener);
	listeners.set(workspaceId, workspaceListeners);

	return () => {
		workspaceListeners.delete(listener);
		if (workspaceListeners.size === 0) {
			listeners.delete(workspaceId);
		}
	};
};

export const requestCalendarRefresh = (workspaceId: string) => {
	revisions.set(workspaceId, getCalendarRefreshRevision(workspaceId) + 1);

	for (const listener of listeners.get(workspaceId) ?? []) {
		listener();
	}
};

export const useCalendarRefreshRevision = (workspaceId: string | null) => {
	const subscribe = React.useCallback(
		(listener: CalendarRefreshListener) =>
			subscribeToCalendarRefresh(workspaceId, listener),
		[workspaceId],
	);
	const getSnapshot = React.useCallback(
		() => getCalendarRefreshRevision(workspaceId),
		[workspaceId],
	);

	return React.useSyncExternalStore(subscribe, getSnapshot, () => 0);
};
