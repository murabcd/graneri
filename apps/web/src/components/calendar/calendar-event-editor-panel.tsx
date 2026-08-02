"use client";

import { Button } from "@workspace/ui/components/button";
import * as React from "react";
import { toast } from "sonner";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import {
	type CalendarEventCreation,
	type CalendarEventDraft,
	createCalendarEventDraftFromEvent,
	createInitialCalendarEventDraft,
	getCalendarEventGuestEmails,
	getCalendarRecurrenceWeekday,
	toCalendarEventCreation,
} from "@/components/calendar/calendar-event-draft";
import { CalendarEventEditorFields } from "@/components/calendar/calendar-event-editor-fields";
import { CalendarEventPanelHeader } from "@/components/calendar/calendar-event-panel-header";
import type { CalendarSource } from "@/components/calendar/calendar-view-model";
import { getConnectionErrorMessage } from "@/components/settings/connection-error-message";
import type { Id } from "../../../../../convex/_generated/dataModel";

export function CalendarEventEditorPanel({
	calendars,
	defaultCalendarId,
	desktopSafeTop,
	event,
	isMobile,
	isPinned,
	onClose,
	onSaveEvent,
	onTogglePinned,
	workspaceId,
}: {
	calendars: CalendarSource[];
	defaultCalendarId: string | null;
	desktopSafeTop: boolean;
	event: UpcomingCalendarEvent | null;
	isMobile: boolean;
	isPinned: boolean;
	onClose: () => void;
	onSaveEvent: (creation: CalendarEventCreation) => Promise<void>;
	onTogglePinned: () => void;
	workspaceId: Id<"workspaces">;
}) {
	const writableCalendars = React.useMemo(
		() => calendars.filter((calendar) => calendar.canCreateEvents),
		[calendars],
	);
	const availableCalendars = React.useMemo(
		() =>
			event
				? writableCalendars.filter(
						(calendar) => calendar.provider === event.provider,
					)
				: writableCalendars,
		[event, writableCalendars],
	);
	const [draft, setDraft] = React.useState(() =>
		event
			? createCalendarEventDraftFromEvent(event)
			: createInitialCalendarEventDraft(writableCalendars, defaultCalendarId),
	);
	const [titleError, setTitleError] = React.useState<string | null>(null);
	const [isSaving, setIsSaving] = React.useState(false);
	const selectedCalendar = availableCalendars.find(
		(calendar) => calendar.id === draft.calendarId,
	);
	const isGuestOnlyEdit = Boolean(
		event && !event.canEdit && event.guestPermissions !== "none",
	);
	const canEditEventDetails = !event || event.canEdit;
	const canEditEventGuests = event?.guestPermissions !== "none";
	const canMoveEvent = !event || event.canMove;
	const initialGuestEmails = React.useMemo(
		() => (event ? getCalendarEventGuestEmails(event) : []),
		[event],
	);
	const lockedGuestEmails = React.useMemo(
		() => (event?.guestPermissions === "invite" ? initialGuestEmails : []),
		[event?.guestPermissions, initialGuestEmails],
	);
	const hasGuestChanges = React.useMemo(() => {
		if (draft.guests.length !== initialGuestEmails.length) {
			return true;
		}

		const initialGuestEmailSet = new Set(initialGuestEmails);
		return draft.guests.some((email) => !initialGuestEmailSet.has(email));
	}, [draft.guests, initialGuestEmails]);

	const patchDraft = React.useCallback(
		(partial: Partial<CalendarEventDraft>) => {
			setDraft((current) => {
				const nextStartWeekday = partial.startDate
					? getCalendarRecurrenceWeekday(partial.startDate)
					: undefined;
				const recurrence =
					partial.recurrence ??
					(nextStartWeekday && !current.recurrence.enabled
						? { ...current.recurrence, weekdays: [nextStartWeekday] }
						: current.recurrence);

				return { ...current, ...partial, recurrence };
			});
		},
		[],
	);

	const handleSubmit = async (formEvent: React.FormEvent<HTMLFormElement>) => {
		formEvent.preventDefault();

		let creation: CalendarEventCreation;

		try {
			if (!selectedCalendar) {
				throw new Error(
					event
						? "This event's calendar is no longer writable."
						: "Select a writable calendar.",
				);
			}

			creation = toCalendarEventCreation(draft, selectedCalendar.provider);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Check the event details.";

			if (!draft.title.trim()) {
				setTitleError(message);
			} else {
				toast.error(message);
			}
			return;
		}

		setTitleError(null);
		setIsSaving(true);

		try {
			await onSaveEvent(creation);
			toast.success(event ? "Event updated." : "Event created.");
			onClose();
		} catch (error) {
			toast.error(
				getConnectionErrorMessage(
					error,
					event ? "Failed to update event" : "Failed to create event",
				),
			);
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<CalendarEventPanelHeader
				title={event ? "Edit event" : "New event"}
				closeLabel={event ? "Close event editor" : "Close new event"}
				desktopSafeTop={desktopSafeTop}
				isMobile={isMobile}
				isPinned={isPinned}
				onClose={onClose}
				onTogglePinned={onTogglePinned}
			/>
			<form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
				<div className="min-h-0 flex-1 overflow-y-auto p-4">
					<CalendarEventEditorFields
						availableCalendars={availableCalendars}
						canEditEventDetails={canEditEventDetails}
						canEditEventGuests={canEditEventGuests}
						canMoveEvent={canMoveEvent}
						draft={draft}
						event={event}
						lockedGuestEmails={lockedGuestEmails}
						onDraftChange={patchDraft}
						onTitleChange={(title) => {
							patchDraft({ title });
							if (titleError) {
								setTitleError(null);
							}
						}}
						selectedCalendar={selectedCalendar}
						titleError={titleError}
						workspaceId={workspaceId}
						writableCalendarCount={writableCalendars.length}
					/>

					<div className="mt-6 flex justify-end">
						<Button
							type="submit"
							disabled={
								isSaving ||
								!selectedCalendar ||
								(isGuestOnlyEdit && !hasGuestChanges)
							}
						>
							{isSaving
								? event
									? "Saving…"
									: "Creating…"
								: event
									? "Save changes"
									: "Create"}
						</Button>
					</div>
				</div>
			</form>
		</div>
	);
}
