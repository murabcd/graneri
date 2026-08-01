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
	toCalendarEventCreation,
} from "@/components/calendar/calendar-event-draft";
import { CalendarEventGuestPicker } from "@/components/calendar/calendar-event-guest-picker";
import { CalendarEventPanelHeader } from "@/components/calendar/calendar-event-panel-header";
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
	const [draft, setDraft] = React.useState(() =>
		event
			? createCalendarEventDraftFromEvent(event)
			: createInitialCalendarEventDraft(writableCalendars, defaultCalendarId),
	);
	const [titleError, setTitleError] = React.useState<string | null>(null);
	const [isSaving, setIsSaving] = React.useState(false);
	const selectedCalendar = writableCalendars.find(
		(calendar) => calendar.id === draft.calendarId,
	);

	const patchDraft = React.useCallback(
		(partial: Partial<CalendarEventDraft>) => {
			setDraft((current) => ({ ...current, ...partial }));
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
							<Field data-invalid={Boolean(titleError)}>
								<FieldLabel
									htmlFor="calendar-event-title"
									className={FIELD_LABEL_CLASS_NAME}
								>
									Title
								</FieldLabel>
								<Input
									id="calendar-event-title"
									aria-invalid={Boolean(titleError)}
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

							<Field>
								<FieldLabel
									htmlFor="calendar-event-calendar"
									className={FIELD_LABEL_CLASS_NAME}
								>
									Calendar
								</FieldLabel>
								<Select
									disabled={Boolean(event)}
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
											{writableCalendars.map((calendar) => (
												<SelectItem key={calendar.id} value={calendar.id}>
													<CalendarSourceLabel calendar={calendar} />
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
								{event ? (
									<FieldDescription className="text-xs">
										Events stay in their original calendar.
									</FieldDescription>
								) : writableCalendars.length === 0 ? (
									<FieldDescription className="text-xs">
										No writable calendars are connected.
									</FieldDescription>
								) : null}
							</Field>

							<Field orientation="horizontal">
								<FieldLabel
									htmlFor="calendar-event-all-day"
									className={FIELD_LABEL_CLASS_NAME}
								>
									All day
								</FieldLabel>
								<Switch
									id="calendar-event-all-day"
									checked={draft.allDay}
									onCheckedChange={(allDay) => patchDraft({ allDay })}
								/>
							</Field>

							<CalendarEventDateTimePicker
								id="calendar-event-date-range"
								label="Date & time"
								allDay={draft.allDay}
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

							<Field>
								<FieldLabel
									htmlFor="calendar-event-location"
									className={FIELD_LABEL_CLASS_NAME}
								>
									Location
								</FieldLabel>
								<Input
									id="calendar-event-location"
									placeholder="Add a room or link"
									value={draft.location}
									onChange={(event) =>
										patchDraft({ location: event.target.value })
									}
								/>
							</Field>

							<Field>
								<FieldLabel
									htmlFor="calendar-event-guests"
									className={FIELD_LABEL_CLASS_NAME}
								>
									Guests
								</FieldLabel>
								<CalendarEventGuestPicker
									id="calendar-event-guests"
									value={draft.guests}
									workspaceId={workspaceId}
									onValueChange={(guests) => patchDraft({ guests })}
								/>
							</Field>

							<Field>
								<FieldLabel
									htmlFor="calendar-event-description"
									className={FIELD_LABEL_CLASS_NAME}
								>
									Description
								</FieldLabel>
								<Textarea
									id="calendar-event-description"
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
						<Button type="submit" disabled={isSaving || !selectedCalendar}>
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
