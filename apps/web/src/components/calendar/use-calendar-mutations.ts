import { useAction } from "convex/react";
import * as React from "react";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import type { CalendarEventCreation } from "@/components/calendar/calendar-event-draft";
import { invalidateCalendarSnapshots } from "@/components/calendar/calendar-snapshot-module";
import type { CalendarCreation } from "@/components/calendar/calendar-view-model";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export const useCalendarMutations = (workspaceId: Id<"workspaces"> | null) => {
	const createCalendarAction = useAction(api.calendar.createCalendar);
	const createCalendarEventAction = useAction(api.calendar.createCalendarEvent);
	const deleteCalendarEventAction = useAction(api.calendar.deleteCalendarEvent);
	const updateCalendarEventAction = useAction(api.calendar.updateCalendarEvent);

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

			await updateCalendarEventAction({
				workspaceId,
				calendarId: event.calendarId,
				description: update.description,
				guests: update.guests,
				location: update.location,
				provider: event.provider,
				providerEventId: event.providerEventId,
				recurrenceId: event.recurrenceId,
				recurrenceIsAllDay: event.recurrenceId ? event.isAllDay : undefined,
				time: update.time,
				title: update.title,
			});
			invalidateCalendarSnapshots(workspaceId);
		},
		[updateCalendarEventAction, workspaceId],
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

	return { createCalendar, createEvent, deleteEvent, updateEvent };
};
