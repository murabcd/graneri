import { useAction } from "convex/react";
import * as React from "react";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import type { CalendarEventCreation } from "@/components/calendar/calendar-event-draft";
import { invalidateCalendarSnapshots } from "@/components/calendar/calendar-snapshot-module";
import type {
	CalendarCreation,
	CalendarRemoval,
	CalendarSource,
	CalendarUpdate,
} from "@/components/calendar/calendar-view-model";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const runCalendarMutation = async <Result>({
	operation,
	workspaceId,
}: {
	operation: (workspaceId: Id<"workspaces">) => Promise<Result>;
	workspaceId: Id<"workspaces"> | null;
}) => {
	if (!workspaceId) {
		throw new Error("Select a workspace before changing the calendar.");
	}

	try {
		return await operation(workspaceId);
	} finally {
		invalidateCalendarSnapshots(workspaceId);
	}
};

export const useCalendarMutations = (workspaceId: Id<"workspaces"> | null) => {
	const createCalendarAction = useAction(api.calendar.createCalendar);
	const deleteCalendarAction = useAction(api.calendar.deleteCalendar);
	const createCalendarEventAction = useAction(api.calendar.createCalendarEvent);
	const deleteCalendarEventAction = useAction(api.calendar.deleteCalendarEvent);
	const removeCalendarEventAction = useAction(api.calendar.removeCalendarEvent);
	const setDefaultCalendarAction = useAction(api.calendar.setDefaultCalendar);
	const updateCalendarEventAction = useAction(api.calendar.updateCalendarEvent);
	const updateCalendarAction = useAction(api.calendar.updateCalendar);

	const createEvent = React.useCallback(
		async (event: CalendarEventCreation) => {
			await runCalendarMutation({
				workspaceId,
				operation: (ownedWorkspaceId) =>
					createCalendarEventAction({
						workspaceId: ownedWorkspaceId,
						...event,
					}),
			});
		},
		[createCalendarEventAction, workspaceId],
	);
	const createCalendar = React.useCallback(
		async (calendar: CalendarCreation) => {
			await runCalendarMutation({
				workspaceId,
				operation: (ownedWorkspaceId) =>
					createCalendarAction({
						workspaceId: ownedWorkspaceId,
						...calendar,
					}),
			});
		},
		[createCalendarAction, workspaceId],
	);
	const updateEvent = React.useCallback(
		async (event: UpcomingCalendarEvent, update: CalendarEventCreation) => {
			await runCalendarMutation({
				workspaceId,
				operation: (ownedWorkspaceId) =>
					updateCalendarEventAction({
						workspaceId: ownedWorkspaceId,
						calendarId: event.calendarId,
						destinationCalendarId: update.calendarId,
						description: update.description,
						guests: update.guests,
						location: update.location,
						provider: event.provider,
						providerEventId: event.providerEventId,
						recurrenceId: event.recurrenceId,
						recurrenceIsAllDay: event.recurrenceId ? event.isAllDay : undefined,
						seriesProviderEventId: event.seriesProviderEventId,
						time: update.time,
						title: update.title,
					}),
			});
		},
		[updateCalendarEventAction, workspaceId],
	);
	const updateCalendar = React.useCallback(
		async (calendar: CalendarSource, update: CalendarUpdate) => {
			await runCalendarMutation({
				workspaceId,
				operation: (ownedWorkspaceId) =>
					updateCalendarAction({
						workspaceId: ownedWorkspaceId,
						calendarId: calendar.id,
						provider: calendar.provider,
						...update,
					}),
			});
		},
		[updateCalendarAction, workspaceId],
	);
	const deleteCalendar = React.useCallback(
		async (calendar: CalendarSource, removal: CalendarRemoval) => {
			await runCalendarMutation({
				workspaceId,
				operation: (ownedWorkspaceId) =>
					deleteCalendarAction({
						workspaceId: ownedWorkspaceId,
						calendarId: calendar.id,
						destinationCalendarId: removal.destinationCalendarId,
						provider: calendar.provider,
					}),
			});
		},
		[deleteCalendarAction, workspaceId],
	);
	const setDefaultCalendar = React.useCallback(
		async (calendar: CalendarSource) => {
			await runCalendarMutation({
				workspaceId,
				operation: (ownedWorkspaceId) =>
					setDefaultCalendarAction({
						workspaceId: ownedWorkspaceId,
						calendarId: calendar.id,
						provider: calendar.provider,
					}),
			});
		},
		[setDefaultCalendarAction, workspaceId],
	);
	const deleteEvent = React.useCallback(
		async (event: UpcomingCalendarEvent) => {
			await runCalendarMutation({
				workspaceId,
				operation: (ownedWorkspaceId) =>
					deleteCalendarEventAction({
						workspaceId: ownedWorkspaceId,
						calendarId: event.calendarId,
						provider: event.provider,
						providerEventId: event.providerEventId,
						recurrenceId: event.recurrenceId,
						recurrenceIsAllDay: event.recurrenceId ? event.isAllDay : undefined,
					}),
			});
		},
		[deleteCalendarEventAction, workspaceId],
	);
	const removeEvent = React.useCallback(
		async (event: UpcomingCalendarEvent) => {
			await runCalendarMutation({
				workspaceId,
				operation: (ownedWorkspaceId) =>
					removeCalendarEventAction({
						workspaceId: ownedWorkspaceId,
						calendarId: event.calendarId,
						provider: event.provider,
						providerEventId: event.providerEventId,
						recurrenceId: event.recurrenceId,
						recurrenceIsAllDay: event.recurrenceId ? event.isAllDay : undefined,
					}),
			});
		},
		[removeCalendarEventAction, workspaceId],
	);

	return {
		createCalendar,
		createEvent,
		deleteCalendar,
		deleteEvent,
		removeEvent,
		setDefaultCalendar,
		updateCalendar,
		updateEvent,
	};
};
