"use client";

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
import type { UpcomingCalendarEvent } from "@/app/app-types";
import { CalendarEventDateTimePicker } from "@/components/calendar/calendar-event-date-time-picker";
import type { CalendarEventDraft } from "@/components/calendar/calendar-event-draft";
import { CalendarEventGuestPicker } from "@/components/calendar/calendar-event-guest-picker";
import { CalendarEventRecurrenceFields } from "@/components/calendar/calendar-event-recurrence-fields";
import {
	CalendarSourceDot,
	CalendarSourceLabel,
} from "@/components/calendar/calendar-source-dot";
import type { CalendarSource } from "@/components/calendar/calendar-view-model";
import type { Id } from "../../../../../convex/_generated/dataModel";

const FIELD_LABEL_CLASS_NAME = "text-xs font-medium text-muted-foreground";

const getCalendarMoveDescription = ({
	canMoveEvent,
	event,
	writableCalendarCount,
}: {
	canMoveEvent: boolean;
	event: UpcomingCalendarEvent | null;
	writableCalendarCount: number;
}) => {
	if (event?.isRecurring && canMoveEvent) {
		return "Moving calendars applies to the entire series.";
	}
	if (event && !canMoveEvent) {
		return "You do not have permission to move this event.";
	}
	return writableCalendarCount === 0
		? "No writable calendars are connected."
		: null;
};

function CalendarSelectionField({
	availableCalendars,
	canMoveEvent,
	draft,
	event,
	onDraftChange,
	selectedCalendar,
	writableCalendarCount,
}: {
	availableCalendars: CalendarSource[];
	canMoveEvent: boolean;
	draft: CalendarEventDraft;
	event: UpcomingCalendarEvent | null;
	onDraftChange: (partial: Partial<CalendarEventDraft>) => void;
	selectedCalendar: CalendarSource | undefined;
	writableCalendarCount: number;
}) {
	const description = getCalendarMoveDescription({
		canMoveEvent,
		event,
		writableCalendarCount,
	});
	return (
		<Field data-disabled={!canMoveEvent || undefined}>
			<FieldLabel
				className={FIELD_LABEL_CLASS_NAME}
				htmlFor="calendar-event-calendar"
			>
				Calendar
			</FieldLabel>
			<Select
				disabled={!canMoveEvent}
				onValueChange={(calendarId) => onDraftChange({ calendarId })}
				value={draft.calendarId}
			>
				<SelectTrigger
					aria-label="Calendar"
					className="w-full"
					id="calendar-event-calendar"
				>
					<span className="flex min-w-0 flex-1 items-center gap-2 text-left">
						{selectedCalendar ? (
							<CalendarSourceDot color={selectedCalendar.color} />
						) : null}
						<SelectValue className="truncate" placeholder="Select calendar">
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
			{description ? (
				<FieldDescription className="text-xs">{description}</FieldDescription>
			) : null}
		</Field>
	);
}

export function CalendarEventEditorFields({
	availableCalendars,
	canEditEventDetails,
	canEditEventGuests,
	canMoveEvent,
	draft,
	event,
	lockedGuestEmails,
	onDraftChange,
	onTitleChange,
	selectedCalendar,
	titleError,
	workspaceId,
	writableCalendarCount,
}: {
	availableCalendars: CalendarSource[];
	canEditEventDetails: boolean;
	canEditEventGuests: boolean;
	canMoveEvent: boolean;
	draft: CalendarEventDraft;
	event: UpcomingCalendarEvent | null;
	lockedGuestEmails: readonly string[];
	onDraftChange: (partial: Partial<CalendarEventDraft>) => void;
	onTitleChange: (title: string) => void;
	selectedCalendar: CalendarSource | undefined;
	titleError: string | null;
	workspaceId: Id<"workspaces">;
	writableCalendarCount: number;
}) {
	return (
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
						onChange={(event) => onTitleChange(event.target.value)}
					/>
					<FieldError className="text-xs">{titleError}</FieldError>
				</Field>

				<CalendarSelectionField
					availableCalendars={availableCalendars}
					canMoveEvent={canMoveEvent}
					draft={draft}
					event={event}
					onDraftChange={onDraftChange}
					selectedCalendar={selectedCalendar}
					writableCalendarCount={writableCalendarCount}
				/>

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
						onCheckedChange={(allDay) => onDraftChange({ allDay })}
					/>
				</Field>

				{event ? null : (
					<CalendarEventRecurrenceFields
						recurrence={draft.recurrence}
						startDate={draft.startDate}
						onValueChange={(recurrence) => onDraftChange({ recurrence })}
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
					onValueChange={onDraftChange}
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
							onDraftChange({ location: event.target.value })
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
						onValueChange={(guests) => onDraftChange({ guests })}
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
							onDraftChange({ description: event.target.value })
						}
					/>
				</Field>
			</FieldGroup>
		</FieldSet>
	);
}
