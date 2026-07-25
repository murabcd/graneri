import { Button } from "@workspace/ui/components/button";
import { CalendarDays, Clock3, MapPin, Video } from "lucide-react";
import type * as React from "react";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import { formatCalendarEventLocation } from "@/components/calendar/calendar-event-location";
import { CalendarEventPanelHeader } from "@/components/calendar/calendar-event-panel-header";
import { CalendarSourceDot } from "@/components/calendar/calendar-source-dot";
import {
	CALENDAR_COLOR_OPTIONS,
	type CalendarSource,
} from "@/components/calendar/calendar-view-model";

const eventDayFormatter = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	month: "long",
	weekday: "long",
});

const eventTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

const toLocalDateKey = (date: Date) =>
	`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

const formatEventSchedule = (event: UpcomingCalendarEvent) => {
	const start = new Date(event.startAt);
	const end = new Date(event.endAt);
	const displayEnd =
		event.isAllDay && end.getTime() > start.getTime()
			? new Date(end.getTime() - 1)
			: end;
	const sameDay = toLocalDateKey(start) === toLocalDateKey(displayEnd);
	const startDay = eventDayFormatter.format(start);
	const endDay = eventDayFormatter.format(displayEnd);

	if (event.isAllDay) {
		return {
			primary: sameDay ? startDay : `${startDay} – ${endDay}`,
			secondary: "All day",
		};
	}

	const startTime = eventTimeFormatter.format(start);
	const endTime = eventTimeFormatter.format(end);

	return {
		primary: sameDay
			? `${startDay} · ${startTime} – ${endTime}`
			: `${startDay}, ${startTime} – ${endDay}, ${endTime}`,
		secondary: null,
	};
};

export function CalendarEventDetailsPanel({
	calendars,
	desktopSafeTop,
	event,
	isMobile,
	isPinned,
	onClose,
	onTakeNote,
	onTogglePinned,
}: {
	calendars: CalendarSource[];
	desktopSafeTop: boolean;
	event: UpcomingCalendarEvent;
	isMobile: boolean;
	isPinned: boolean;
	onClose: () => void;
	onTakeNote: (event: UpcomingCalendarEvent) => void;
	onTogglePinned: () => void;
}) {
	const calendarColor =
		calendars.find((calendar) => calendar.id === event.calendarId)?.color ??
		CALENDAR_COLOR_OPTIONS[0].value;
	const schedule = formatEventSchedule(event);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<CalendarEventPanelHeader
				title={event.title}
				closeLabel="Close event details"
				desktopSafeTop={desktopSafeTop}
				isMobile={isMobile}
				isPinned={isPinned}
				onClose={onClose}
				onTogglePinned={onTogglePinned}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto p-4">
				<div className="flex flex-col gap-6">
					<CalendarEventDetailRow icon={Clock3}>
						<p>{schedule.primary}</p>
						{schedule.secondary ? (
							<p className="mt-1 text-muted-foreground">{schedule.secondary}</p>
						) : null}
					</CalendarEventDetailRow>

					<CalendarEventDetailRow icon={CalendarDays}>
						<div className="flex min-w-0 items-center gap-2">
							<CalendarSourceDot color={calendarColor} />
							<span className="truncate">{event.calendarName}</span>
						</div>
					</CalendarEventDetailRow>

					{event.location ? (
						<CalendarEventDetailRow icon={MapPin}>
							<p className="break-words">
								{formatCalendarEventLocation(event.location)}
							</p>
						</CalendarEventDetailRow>
					) : null}

					{event.isMeeting ? (
						<CalendarEventDetailRow icon={Video}>
							<p>{event.meetingUrl ? "Video meeting" : "Meeting"}</p>
						</CalendarEventDetailRow>
					) : null}

					<div className="flex items-center justify-end gap-2">
						<Button type="button" onClick={() => onTakeNote(event)}>
							Take note
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

function CalendarEventDetailRow({
	children,
	icon: Icon,
}: {
	children: React.ReactNode;
	icon: React.ComponentType<{ className?: string }>;
}) {
	return (
		<div className="flex items-start gap-3">
			<Icon className="size-4 shrink-0 text-muted-foreground" />
			<div className="min-w-0 flex-1 text-xs">{children}</div>
		</div>
	);
}
