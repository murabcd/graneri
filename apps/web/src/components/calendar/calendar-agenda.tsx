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
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Spinner } from "@workspace/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "cn";
import {
	Ban,
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
import { getAllDayDisplayDate } from "@/components/calendar/calendar-all-day-date";
import { formatCalendarRecurrence } from "@/components/calendar/calendar-recurrence";
import type {
	CalendarAgendaRange,
	CalendarSource,
} from "@/components/calendar/calendar-view-model";
import { HoverScrollTitle } from "@/components/hover-scroll-title";
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
	onRemoveEvent: (event: UpcomingCalendarEvent) => Promise<void>;
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

type PendingCalendarEventAction = {
	event: UpcomingCalendarEvent;
	kind: "delete" | "remove";
};

const destructiveAlertActionClassName =
	"bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive dark:text-red-500 dark:hover:bg-destructive/25";

const getPendingEventActionCopy = ({
	event,
	kind,
}: PendingCalendarEventAction) => {
	if (kind === "delete") {
		return {
			actionLabel: "Delete",
			description: event.isRecurring
				? "This action cannot be undone. This will delete this occurrence for every guest and remove it from the connected calendar. The rest of the series will stay."
				: "This action cannot be undone. This will delete the event for every guest and remove it from the connected calendar.",
			pendingLabel: "Deleting…",
		};
	}

	return event.provider === "yandex"
		? {
				actionLabel: "Not going",
				description:
					"This action cannot be undone. This will mark you as not going, notify the organizer, and remove the event from your calendar.",
				pendingLabel: "Removing…",
			}
		: {
				actionLabel: "Remove",
				description:
					"This action cannot be undone. This will remove the event from your calendar. The event will remain on the organizer's and other guests' calendars.",
				pendingLabel: "Removing…",
			};
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
		const start = new Date(event.startAt);
		const date = event.isAllDay ? getAllDayDisplayDate(start) : start;
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
	onRemoveEvent,
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
	const [pendingEventAction, setPendingEventAction] =
		React.useState<PendingCalendarEventAction | null>(null);
	const [isResolvingEventAction, setIsResolvingEventAction] =
		React.useState(false);
	const pendingEventActionCopy = pendingEventAction
		? getPendingEventActionCopy(pendingEventAction)
		: null;
	const handleRequestDelete = React.useCallback(
		(event: UpcomingCalendarEvent) => {
			setPendingEventAction({ event, kind: "delete" });
		},
		[],
	);
	const handleRequestRemove = React.useCallback(
		(event: UpcomingCalendarEvent) => {
			setPendingEventAction({ event, kind: "remove" });
		},
		[],
	);
	const handleToday = () => {
		if (scrollViewportRef.current) {
			scrollViewportRef.current.scrollTop = 0;
		}
		onToday();
	};
	const handleConfirmedEventAction = async () => {
		if (!pendingEventAction) {
			return;
		}

		setIsResolvingEventAction(true);
		try {
			const { event, kind } = pendingEventAction;
			await (kind === "delete" ? onDeleteEvent(event) : onRemoveEvent(event));
			toast.success(
				kind === "remove"
					? event.provider === "yandex"
						? "Invitation declined."
						: "Event removed from your calendar."
					: event.isRecurring
						? "Occurrence deleted."
						: "Event deleted.",
			);
			setPendingEventAction(null);
		} catch (error) {
			toast.error(
				getConnectionErrorMessage(
					error,
					pendingEventAction.kind === "remove"
						? "Failed to remove event"
						: "Failed to delete event",
				),
			);
		} finally {
			setIsResolvingEventAction(false);
		}
	};

	return (
		<div
			aria-busy={loading}
			className={cn(
				"flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-sm",
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
					{loading ? (
						<output
							aria-live="polite"
							className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
						>
							<Spinner aria-hidden="true" className="size-3" />
							<span>Updating…</span>
						</output>
					) : null}
				</div>
				<div className="flex items-center gap-2">{actions}</div>
			</div>

			<section
				ref={scrollViewportRef}
				aria-label="Calendar agenda"
				className={cn(
					"scroll-fade-b min-h-0 flex-1 overflow-y-auto transition-[opacity,filter] duration-150",
					loading && "pointer-events-none opacity-50 saturate-50",
				)}
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
										onClick={onEventClick}
										onEdit={onEditEvent}
										onRequestDelete={handleRequestDelete}
										onRequestRemove={handleRequestRemove}
									/>
								);
							})}
						</div>
					))}
				</div>
			</section>
			{pendingEventAction ? (
				<AlertDialog
					open
					onOpenChange={(open) => {
						if (!open && !isResolvingEventAction) {
							setPendingEventAction(null);
						}
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
							<AlertDialogDescription>
								{pendingEventActionCopy?.description}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={isResolvingEventAction}>
								Cancel
							</AlertDialogCancel>
							<AlertDialogAction
								className={destructiveAlertActionClassName}
								disabled={isResolvingEventAction}
								onClick={(dialogEvent) => {
									dialogEvent.preventDefault();
									void handleConfirmedEventAction();
								}}
							>
								{isResolvingEventAction
									? pendingEventActionCopy?.pendingLabel
									: pendingEventActionCopy?.actionLabel}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			) : null}
		</div>
	);
}

function RecurringEventIndicator({ event }: { event: UpcomingCalendarEvent }) {
	if (!event.isRecurring) {
		return null;
	}
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex shrink-0" data-recurring-indicator>
					<Repeat2 aria-hidden className="size-3.5 text-muted-foreground" />
				</span>
			</TooltipTrigger>
			<TooltipContent>
				{event.recurrence
					? formatCalendarRecurrence(event.recurrence)
					: "Recurring event"}
			</TooltipContent>
		</Tooltip>
	);
}

function CalendarAgendaEventActions({
	closedByPointerOutsideRef,
	event,
	onEdit,
	onRequestDelete,
	onRequestRemove,
}: {
	closedByPointerOutsideRef: React.MutableRefObject<boolean>;
	event: UpcomingCalendarEvent;
	onEdit: (event: UpcomingCalendarEvent) => void;
	onRequestDelete: (event: UpcomingCalendarEvent) => void;
	onRequestRemove: (event: UpcomingCalendarEvent) => void;
}) {
	const hasActions =
		event.canEdit ||
		event.guestPermissions !== "none" ||
		event.canDelete ||
		event.canRemove;
	if (!hasActions) {
		return null;
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					aria-label={`Open actions for ${event.title}`}
					className="absolute top-1/2 right-2 flex aspect-square size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md p-0 text-muted-foreground opacity-0 outline-hidden transition-[color,opacity] hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/event:opacity-100 data-[state=open]:opacity-100 data-[state=open]:text-foreground"
					type="button"
				>
					<MoreHorizontal aria-hidden className="size-4" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				onCloseAutoFocus={(closeEvent) => {
					if (!closedByPointerOutsideRef.current) {
						return;
					}
					closeEvent.preventDefault();
					closedByPointerOutsideRef.current = false;
				}}
				onPointerDownOutside={() => {
					closedByPointerOutsideRef.current = true;
				}}
			>
				<DropdownMenuGroup>
					<DropdownMenuItem
						disabled={!event.canEdit && event.guestPermissions === "none"}
						onSelect={() => onEdit(event)}
					>
						<Pencil aria-hidden />
						Edit
					</DropdownMenuItem>
					{event.canRemove ? (
						<DropdownMenuItem onSelect={() => onRequestRemove(event)}>
							{event.provider === "yandex" ? (
								<Ban aria-hidden />
							) : (
								<Trash2 aria-hidden />
							)}
							{event.provider === "yandex"
								? "Not going"
								: "Remove from calendar"}
						</DropdownMenuItem>
					) : null}
				</DropdownMenuGroup>
				{event.canRemove ? null : (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem
								disabled={!event.canDelete}
								onSelect={() => onRequestDelete(event)}
								variant="destructive"
							>
								<Trash2 aria-hidden />
								Delete
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

const CalendarAgendaEventRow = React.memo(function CalendarAgendaEventRow({
	color,
	event,
	onClick,
	onEdit,
	onRequestDelete,
	onRequestRemove,
}: {
	color: string;
	event: UpcomingCalendarEvent;
	onClick: (event: UpcomingCalendarEvent) => void;
	onEdit: (event: UpcomingCalendarEvent) => void;
	onRequestDelete: (event: UpcomingCalendarEvent) => void;
	onRequestRemove: (event: UpcomingCalendarEvent) => void;
}) {
	const closedByPointerOutsideRef = React.useRef(false);
	const hasActions =
		event.canEdit ||
		event.guestPermissions !== "none" ||
		event.canDelete ||
		event.canRemove;

	return (
		<div className="group/event relative border-b">
			<button
				type="button"
				aria-label={`${event.title}, ${formatAgendaTime(event)}${event.isRecurring ? ", recurring" : ""}`}
				className={cn(
					"flex w-full min-w-0 cursor-pointer items-center gap-3 px-4 py-2.5 text-start outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/50",
					hasActions && "pr-12",
				)}
				data-hover-scroll-title-row
				onClick={() => onClick(event)}
			>
				<span className="w-40 shrink-0 truncate text-sm text-muted-foreground tabular-nums">
					{formatAgendaTime(event)}
				</span>
				<span
					aria-hidden
					className="size-2 shrink-0 rounded-full"
					style={{ backgroundColor: color }}
				/>
				<span className="flex min-w-0 flex-1 items-center">
					<span
						className="inline-flex min-w-0 max-w-full items-center gap-2"
						data-calendar-event-title
					>
						<HoverScrollTitle className="text-sm">
							{event.title}
						</HoverScrollTitle>
						<RecurringEventIndicator event={event} />
					</span>
				</span>
			</button>
			<CalendarAgendaEventActions
				closedByPointerOutsideRef={closedByPointerOutsideRef}
				event={event}
				onEdit={onEdit}
				onRequestDelete={onRequestDelete}
				onRequestRemove={onRequestRemove}
			/>
		</div>
	);
});
