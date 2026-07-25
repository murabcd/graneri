"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
	ChevronLeft,
	ChevronRight,
	MoreHorizontal,
	Pencil,
	Repeat2,
	Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import type {
	CalendarAgendaRange,
	CalendarSource,
} from "@/components/calendar/calendar-view-model";
import { getConnectionErrorMessage } from "@/components/settings/connection-error-message";

const agendaDayFormatter = new Intl.DateTimeFormat(undefined, {
	weekday: "long",
});

const agendaDateFormatter = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	month: "long",
	year: "numeric",
});

const agendaTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

const agendaRangeStartFormatter = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	month: "short",
});

const agendaRangeEndFormatter = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	month: "short",
	year: "numeric",
});

type CalendarAgendaProps = {
	actions: React.ReactNode;
	calendars: CalendarSource[];
	className?: string;
	events: UpcomingCalendarEvent[];
	loading: boolean;
	onDeleteEvent: (event: UpcomingCalendarEvent) => Promise<void>;
	onEditEvent: (event: UpcomingCalendarEvent) => void;
	onEventClick: (event: UpcomingCalendarEvent) => void;
	onNext: () => void;
	onPrevious: () => void;
	onToday: () => void;
	range: CalendarAgendaRange;
};

type CalendarAgendaGroup = {
	date: Date;
	events: UpcomingCalendarEvent[];
	key: string;
};

const toLocalDateKey = (date: Date) =>
	`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

const groupAgendaEvents = (
	events: UpcomingCalendarEvent[],
): CalendarAgendaGroup[] => {
	const groups = new Map<string, CalendarAgendaGroup>();
	const sortedEvents = events.toSorted(
		(left, right) =>
			new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
	);

	for (const event of sortedEvents) {
		const date = new Date(event.startAt);
		const key = toLocalDateKey(date);
		const existing = groups.get(key);

		if (existing) {
			existing.events.push(event);
		} else {
			groups.set(key, { date, events: [event], key });
		}
	}

	return [...groups.values()];
};

const formatAgendaTime = (event: UpcomingCalendarEvent) =>
	event.isAllDay
		? "All day"
		: `${agendaTimeFormatter.format(new Date(event.startAt))} – ${agendaTimeFormatter.format(new Date(event.endAt))}`;

const formatAgendaRange = ({ end, start }: CalendarAgendaRange) => {
	const inclusiveEnd = new Date(end);
	inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
	return `${agendaRangeStartFormatter.format(start)} – ${agendaRangeEndFormatter.format(inclusiveEnd)}`;
};

const getCalendarForEvent = (
	calendarsById: ReadonlyMap<string, CalendarSource>,
	event: UpcomingCalendarEvent,
) => {
	const calendar = calendarsById.get(event.calendarId);

	if (!calendar) {
		throw new Error(
			`Calendar event "${event.providerEventId}" references unknown calendar "${event.calendarId}".`,
		);
	}

	return calendar;
};

export function CalendarAgenda({
	actions,
	calendars,
	className,
	events,
	loading,
	onDeleteEvent,
	onEditEvent,
	onEventClick,
	onNext,
	onPrevious,
	onToday,
	range,
}: CalendarAgendaProps) {
	const scrollViewportRef = React.useRef<HTMLDivElement>(null);
	const calendarsById = React.useMemo(
		() => new Map(calendars.map((calendar) => [calendar.id, calendar])),
		[calendars],
	);
	const groups = React.useMemo(() => groupAgendaEvents(events), [events]);
	const todayKey = toLocalDateKey(new Date());
	const [eventPendingDeletion, setEventPendingDeletion] =
		React.useState<UpcomingCalendarEvent | null>(null);
	const [isDeleting, setIsDeleting] = React.useState(false);
	const handleToday = () => {
		if (scrollViewportRef.current) {
			scrollViewportRef.current.scrollTop = 0;
		}
		onToday();
	};
	const handleDelete = async () => {
		if (!eventPendingDeletion) {
			return;
		}

		setIsDeleting(true);
		try {
			await onDeleteEvent(eventPendingDeletion);
			toast.success(
				eventPendingDeletion.isRecurring
					? "Occurrence deleted."
					: "Event deleted.",
			);
			setEventPendingDeletion(null);
		} catch (error) {
			toast.error(getConnectionErrorMessage(error, "Failed to delete event"));
		} finally {
			setIsDeleting(false);
		}
	};

	return (
		<div
			aria-busy={loading}
			className={cn(
				"flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background",
				className,
			)}
		>
			<div className="flex min-w-0 flex-wrap items-center gap-2 border-b px-2 py-1.5">
				<div className="flex min-w-0 flex-1 items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						disabled={loading}
						onClick={handleToday}
					>
						Today
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Previous 30 days"
						disabled={loading}
						onClick={onPrevious}
					>
						<ChevronLeft />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Next 30 days"
						disabled={loading}
						onClick={onNext}
					>
						<ChevronRight />
					</Button>
					<p className="truncate px-2 text-sm font-medium tabular-nums">
						{formatAgendaRange(range)}
					</p>
				</div>
				<div className="flex items-center gap-2">{actions}</div>
			</div>

			<section
				ref={scrollViewportRef}
				aria-label="Calendar agenda"
				className="min-h-0 flex-1 overflow-y-auto"
			>
				<div className="flex flex-col [&>*:last-child>*:last-child]:border-b-0">
					{groups.map((group) => (
						<div key={group.key}>
							<div className="sticky top-0 z-10 flex items-baseline justify-between gap-4 border-b bg-muted/60 px-4 py-2">
								<span
									className={cn(
										"text-sm font-normal",
										group.key === todayKey && "text-primary",
									)}
								>
									{agendaDayFormatter.format(group.date)}
								</span>
								<span className="text-xs font-medium text-muted-foreground tabular-nums">
									{agendaDateFormatter.format(group.date)}
								</span>
							</div>
							{group.events.map((event) => {
								const calendar = getCalendarForEvent(calendarsById, event);

								return (
									<CalendarAgendaEventRow
										key={`${event.calendarId}:${event.id}:${event.startAt}`}
										color={calendar.color}
										event={event}
										isWritable={calendar.canCreateEvents}
										onClick={() => onEventClick(event)}
										onEdit={() => onEditEvent(event)}
										onRequestDelete={() => setEventPendingDeletion(event)}
									/>
								);
							})}
						</div>
					))}
				</div>
			</section>
			{eventPendingDeletion ? (
				<AlertDialog
					open
					onOpenChange={(open) => {
						if (!open && !isDeleting) {
							setEventPendingDeletion(null);
						}
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								{eventPendingDeletion.isRecurring
									? "Delete this occurrence?"
									: "Delete event?"}
							</AlertDialogTitle>
							<AlertDialogDescription>
								{eventPendingDeletion.isRecurring
									? "Only this occurrence will be deleted. The rest of the series will stay on your calendar."
									: "This event will be permanently deleted from your calendar."}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={isDeleting}>
								Cancel
							</AlertDialogCancel>
							<AlertDialogAction
								className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
								disabled={isDeleting}
								onClick={(dialogEvent) => {
									dialogEvent.preventDefault();
									void handleDelete();
								}}
							>
								{isDeleting ? "Deleting…" : "Delete"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			) : null}
		</div>
	);
}

function CalendarAgendaEventRow({
	color,
	event,
	isWritable,
	onClick,
	onEdit,
	onRequestDelete,
}: {
	color: string;
	event: UpcomingCalendarEvent;
	isWritable: boolean;
	onClick: () => void;
	onEdit: () => void;
	onRequestDelete: () => void;
}) {
	return (
		<div className="group/event relative border-b">
			<Tooltip delayDuration={150}>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label={`${event.title}, ${formatAgendaTime(event)}${event.isRecurring ? ", recurring" : ""}`}
						className={cn(
							"flex w-full min-w-0 cursor-pointer items-center gap-3 px-4 py-2.5 text-start outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/50",
							isWritable && "pr-12",
						)}
						onClick={onClick}
					>
						<span className="w-40 shrink-0 truncate text-sm text-muted-foreground tabular-nums">
							{formatAgendaTime(event)}
						</span>
						<span
							aria-hidden
							className="size-2 shrink-0 rounded-full"
							style={{ backgroundColor: color }}
						/>
						<span className="flex min-w-0 flex-1 items-center gap-2">
							<span className="truncate text-sm">{event.title}</span>
							{event.isRecurring ? (
								<Repeat2
									aria-hidden
									className="size-3.5 shrink-0 text-muted-foreground"
								/>
							) : null}
						</span>
					</button>
				</TooltipTrigger>
				<TooltipContent side="top" align="center">
					{event.title}
				</TooltipContent>
			</Tooltip>
			{isWritable ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-label={`Open actions for ${event.title}`}
							className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 outline-hidden transition-[color,opacity] hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/event:opacity-100 group-focus-within/event:opacity-100 data-[state=open]:opacity-100 data-[state=open]:text-foreground"
						>
							<MoreHorizontal className="size-4" aria-hidden />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onSelect={onEdit}>
							<Pencil className="size-4" aria-hidden />
							Edit
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem variant="destructive" onSelect={onRequestDelete}>
							<Trash2 className="size-4" aria-hidden />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</div>
	);
}
