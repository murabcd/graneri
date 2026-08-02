"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { Switch } from "@workspace/ui/components/switch";
import { Textarea } from "@workspace/ui/components/textarea";
import * as React from "react";
import { toast } from "sonner";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import { CalendarEventDateTimePicker } from "@/components/calendar/calendar-event-date-time-picker";
import {
	type CalendarEventCreation,
	type CalendarEventDraft,
	createCalendarEventDraftFromEvent,
	createInitialCalendarEventDraft,
	getCalendarRecurrenceWeekday,
	toCalendarEventCreation,
} from "@/components/calendar/calendar-event-draft";
import { CalendarEventGuestPicker } from "@/components/calendar/calendar-event-guest-picker";
import { CalendarEventPanelHeader } from "@/components/calendar/calendar-event-panel-header";
import { CalendarEventRecurrenceFields } from "@/components/calendar/calendar-event-recurrence-fields";
import {
	CalendarSourceDot,
	CalendarSourceLabel,
} from "@/components/calendar/calendar-source-dot";
import type { CalendarSource } from "@/components/calendar/calendar-view-model";
import { getConnectionErrorMessage } from "@/components/settings/connection-error-message";
import type { Id } from "../../../../../convex/_generated/dataModel";

const FIELD_LABEL_CLASS_NAME = "text-xs font-medium text-muted-foreground";

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
		() =>
			(event?.attendees ?? [])
				.filter((attendee) => !attendee.isOrganizer && !attendee.isSelf)
				.map((attendee) => attendee.email),
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
					<FieldSet>
						<FieldLegend className="sr-only">Event details</FieldLegend>
						<FieldGroup>
							<Field
								data-disabled={!canEditEventDetails || undefined}
								data-invalid={Boolean(titleError)}
							>
								<FieldLabel
									htmlFor="calendar-event-title"
									className={FIELD_LABEL_CLASS_NAME}
								>
									Title
								</FieldLabel>
								<Input
									id="calendar-event-title"
									aria-invalid={Boolean(titleError)}
									disabled={!canEditEventDetails}
									placeholder="Add title"
									value={draft.title}
									onChange={(event) => {
										patchDraft({ title: event.target.value });
										if (titleError) {
											setTitleError(null);
										}
									}}
								/>
								<FieldError className="text-xs">{titleError}</FieldError>
							</Field>

							<Field data-disabled={!canMoveEvent || undefined}>
								<FieldLabel
									htmlFor="calendar-event-calendar"
									className={FIELD_LABEL_CLASS_NAME}
								>
									Calendar
								</FieldLabel>
								<Select
									disabled={!canMoveEvent}
									value={draft.calendarId}
									onValueChange={(calendarId) => patchDraft({ calendarId })}
								>
									<SelectTrigger
										id="calendar-event-calendar"
										className="w-full"
										aria-label="Calendar"
									>
										<span className="flex min-w-0 flex-1 items-center gap-2 text-left">
											{selectedCalendar ? (
												<CalendarSourceDot color={selectedCalendar.color} />
											) : null}
											<SelectValue
												className="truncate"
												placeholder="Select calendar"
											>
												{selectedCalendar?.name ?? "Select calendar"}
											</SelectValue>
										</span>
									</SelectTrigger>
									<SelectContent align="end">
										<SelectGroup>
											{availableCalendars.map((calendar) => (
												<SelectItem key={calendar.id} value={calendar.id}>
													<CalendarSourceLabel calendar={calendar} />
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
								{event?.isRecurring && canMoveEvent ? (
									<FieldDescription className="text-xs">
										Moving calendars applies to the entire series.
									</FieldDescription>
								) : event && !canMoveEvent ? (
									<FieldDescription className="text-xs">
										You do not have permission to move this event.
									</FieldDescription>
								) : writableCalendars.length === 0 ? (
									<FieldDescription className="text-xs">
										No writable calendars are connected.
									</FieldDescription>
								) : null}
							</Field>

							<Field
								data-disabled={!canEditEventDetails || undefined}
								orientation="horizontal"
							>
								<FieldLabel
									htmlFor="calendar-event-all-day"
									className={FIELD_LABEL_CLASS_NAME}
								>
									All day
								</FieldLabel>
								<Switch
									id="calendar-event-all-day"
									checked={draft.allDay}
									disabled={!canEditEventDetails}
									onCheckedChange={(allDay) => patchDraft({ allDay })}
								/>
							</Field>

							{event ? null : (
								<CalendarEventRecurrenceFields
									recurrence={draft.recurrence}
									startDate={draft.startDate}
									onValueChange={(recurrence) => patchDraft({ recurrence })}
								/>
							)}

							<CalendarEventDateTimePicker
								id="calendar-event-date-range"
								label="Date & time"
								allDay={draft.allDay}
								disabled={!canEditEventDetails}
								startDateValue={draft.startDate}
								endDateValue={draft.endDate}
								startTimeValue={draft.startTime}
								endTimeValue={draft.endTime}
								onValueChange={patchDraft}
							/>
							{event?.isRecurring ? (
								<FieldDescription className="-mt-4 text-xs">
									Changes apply only to this occurrence.
								</FieldDescription>
							) : null}

							<Field data-disabled={!canEditEventDetails || undefined}>
								<FieldLabel
									htmlFor="calendar-event-location"
									className={FIELD_LABEL_CLASS_NAME}
								>
									Location
								</FieldLabel>
								<Input
									id="calendar-event-location"
									disabled={!canEditEventDetails}
									placeholder="Add a room or link"
									value={draft.location}
									onChange={(event) =>
										patchDraft({ location: event.target.value })
									}
								/>
							</Field>

							<Field data-disabled={!canEditEventGuests || undefined}>
								<FieldLabel
									htmlFor="calendar-event-guests"
									className={FIELD_LABEL_CLASS_NAME}
								>
									Guests
								</FieldLabel>
								<CalendarEventGuestPicker
									disabled={!canEditEventGuests}
									id="calendar-event-guests"
									lockedValues={lockedGuestEmails}
									value={draft.guests}
									workspaceId={workspaceId}
									onValueChange={(guests) => patchDraft({ guests })}
								/>
							</Field>

							<Field data-disabled={!canEditEventDetails || undefined}>
								<FieldLabel
									htmlFor="calendar-event-description"
									className={FIELD_LABEL_CLASS_NAME}
								>
									Description
								</FieldLabel>
								<Textarea
									id="calendar-event-description"
									disabled={!canEditEventDetails}
									className="min-h-28 resize-none"
									placeholder="Add notes or an agenda"
									value={draft.description}
									onChange={(event) =>
										patchDraft({ description: event.target.value })
									}
								/>
							</Field>
						</FieldGroup>
					</FieldSet>

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
