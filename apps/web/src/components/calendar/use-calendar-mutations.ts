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
			if (!workspaceId) {
				throw new Error("Select a workspace before creating an event.");
			}

			await createCalendarEventAction({ workspaceId, ...event });
			invalidateCalendarSnapshots(workspaceId);
		},
		[createCalendarEventAction, workspaceId],
	);
	const createCalendar = React.useCallback(
		async (calendar: CalendarCreation) => {
			if (!workspaceId) {
				throw new Error("Select a workspace before creating a calendar.");
			}

			await createCalendarAction({ workspaceId, ...calendar });
			invalidateCalendarSnapshots(workspaceId);
		},
		[createCalendarAction, workspaceId],
	);
	const updateEvent = React.useCallback(
		async (event: UpcomingCalendarEvent, update: CalendarEventCreation) => {
			if (!workspaceId) {
				throw new Error("Select a workspace before updating an event.");
			}

			try {
				await updateCalendarEventAction({
					workspaceId,
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
				});
			} finally {
				invalidateCalendarSnapshots(workspaceId);
			}
		},
		[updateCalendarEventAction, workspaceId],
	);
	const updateCalendar = React.useCallback(
		async (calendar: CalendarSource, update: CalendarUpdate) => {
			if (!workspaceId) {
				throw new Error("Select a workspace before updating a calendar.");
			}

			try {
				await updateCalendarAction({
					workspaceId,
					calendarId: calendar.id,
					provider: calendar.provider,
					...update,
				});
			} finally {
				invalidateCalendarSnapshots(workspaceId);
			}
		},
		[updateCalendarAction, workspaceId],
	);
	const deleteCalendar = React.useCallback(
		async (calendar: CalendarSource, removal: CalendarRemoval) => {
			if (!workspaceId) {
				throw new Error("Select a workspace before deleting a calendar.");
			}

			try {
				await deleteCalendarAction({
					workspaceId,
					calendarId: calendar.id,
					destinationCalendarId: removal.destinationCalendarId,
					provider: calendar.provider,
				});
			} finally {
				invalidateCalendarSnapshots(workspaceId);
			}
		},
		[deleteCalendarAction, workspaceId],
	);
	const setDefaultCalendar = React.useCallback(
		async (calendar: CalendarSource) => {
			if (!workspaceId) {
				throw new Error(
					"Select a workspace before setting a default calendar.",
				);
			}

			try {
				await setDefaultCalendarAction({
					workspaceId,
					calendarId: calendar.id,
					provider: calendar.provider,
				});
			} finally {
				invalidateCalendarSnapshots(workspaceId);
			}
		},
		[setDefaultCalendarAction, workspaceId],
	);
	const deleteEvent = React.useCallback(
		async (event: UpcomingCalendarEvent) => {
			if (!workspaceId) {
				throw new Error("Select a workspace before deleting an event.");
			}

			await deleteCalendarEventAction({
				workspaceId,
				calendarId: event.calendarId,
				provider: event.provider,
				providerEventId: event.providerEventId,
				recurrenceId: event.recurrenceId,
				recurrenceIsAllDay: event.recurrenceId ? event.isAllDay : undefined,
			});
			invalidateCalendarSnapshots(workspaceId);
		},
		[deleteCalendarEventAction, workspaceId],
	);
	const removeEvent = React.useCallback(
		async (event: UpcomingCalendarEvent) => {
			if (!workspaceId) {
				throw new Error("Select a workspace before removing an event.");
			}

			await removeCalendarEventAction({
				workspaceId,
				calendarId: event.calendarId,
				provider: event.provider,
				providerEventId: event.providerEventId,
				recurrenceId: event.recurrenceId,
				recurrenceIsAllDay: event.recurrenceId ? event.isAllDay : undefined,
			});
			invalidateCalendarSnapshots(workspaceId);
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
