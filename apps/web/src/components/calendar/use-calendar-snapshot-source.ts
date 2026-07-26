import { useQuery } from "convex/react";
import * as React from "react";
import {
	createCalendarSourceKey,
	observeCalendarSnapshotSource,
	readCalendarSnapshotGeneration,
	subscribeToCalendarSnapshotGeneration,
} from "@/components/calendar/calendar-snapshot-module";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export const useCalendarSnapshotSource = ({
	enabled,
	workspaceId,
}: {
	enabled: boolean;
	workspaceId: Id<"workspaces"> | null;
}) => {
	const queryArgs = enabled && workspaceId ? { workspaceId } : "skip";
	const calendarPreferences = useQuery(api.calendarPreferences.get, queryArgs);
	const yandexCalendarConnection = useQuery(
		api.appConnections.getYandexCalendar,
		queryArgs,
	);
	const sourceKey =
		calendarPreferences !== undefined && yandexCalendarConnection !== undefined
			? createCalendarSourceKey({
					showGoogleCalendar: calendarPreferences.showGoogleCalendar,
					showYandexCalendar: calendarPreferences.showYandexCalendar,
					yandexConnectionSourceId: yandexCalendarConnection?.sourceId ?? null,
					yandexConnectionStatus: yandexCalendarConnection?.status ?? null,
				})
			: null;

	React.useEffect(() => {
		if (workspaceId && sourceKey) {
			observeCalendarSnapshotSource(workspaceId, sourceKey);
		}
	}, [sourceKey, workspaceId]);

	const subscribe = React.useCallback(
		(listener: () => void) =>
			subscribeToCalendarSnapshotGeneration(workspaceId, listener),
		[workspaceId],
	);
	const getSnapshot = React.useCallback(
		() => readCalendarSnapshotGeneration(workspaceId),
		[workspaceId],
	);
	const generation = React.useSyncExternalStore(
		subscribe,
		getSnapshot,
		() => 0,
	);

	return { generation, sourceKey };
};
