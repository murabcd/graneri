"use client";

import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import { cn } from "@workspace/ui/lib/utils";
import { CalendarDays, ChevronDown, Plus, RefreshCw } from "lucide-react";
import * as React from "react";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import { CalendarAgenda } from "@/components/calendar/calendar-agenda";
import type { CalendarEventCreation } from "@/components/calendar/calendar-event-draft";
import {
	type CalendarEventPanelState,
	CalendarEventSheet,
} from "@/components/calendar/calendar-event-sheet";
import { CalendarNewCalendarDialog } from "@/components/calendar/calendar-new-calendar-dialog";
import { OPEN_NEW_CALENDAR_EVENT } from "@/components/calendar/calendar-page-events";
import { CalendarSourceLabel } from "@/components/calendar/calendar-source-dot";
import {
	type CalendarProvider,
	type CalendarProviderOption,
	type CalendarSource,
	filterCalendarEvents,
} from "@/components/calendar/calendar-view-model";
import { useCalendarAgendaSession } from "@/components/calendar/use-calendar-agenda-session";
import { PageTitle } from "@/components/layout/page-title";

export function CalendarPage({
	accountId,
	isDesktopMac,
	onOpenCalendarEventNote,
	onOpenCalendarSettings,
}: {
	accountId: string | null;
	isDesktopMac: boolean;
	onOpenCalendarEventNote: (
		event: UpcomingCalendarEvent,
	) => Promise<void> | void;
	onOpenCalendarSettings: () => void;
}) {
	const {
		activeWorkspaceId,
		createCalendar,
		createEvent,
		deleteEvent,
		range,
		retry,
		setAgendaStart,
		shiftRange,
		state,
		updateEvent,
	} = useCalendarAgendaSession(accountId);
	const [calendarFilter, setCalendarFilter] = React.useState<{
		excludedCalendarIds: Set<string>;
		workspaceId: string | null;
	}>(() => ({
		excludedCalendarIds: new Set(),
		workspaceId: activeWorkspaceId,
	}));
	const [newCalendarOpen, setNewCalendarOpen] = React.useState(false);
	const [eventPanel, setEventPanel] =
		React.useState<CalendarEventPanelState | null>(null);
	const handleUpdateEvent = React.useCallback(
		async (event: UpcomingCalendarEvent, update: CalendarEventCreation) => {
			await updateEvent(event, update);
			setEventPanel(null);
		},
		[updateEvent],
	);
	const handleDeleteEvent = React.useCallback(
		async (event: UpcomingCalendarEvent) => {
			await deleteEvent(event);
			setEventPanel(null);
		},
		[deleteEvent],
	);

	React.useEffect(() => {
		const toggleNewEventSheet = () => {
			setEventPanel((current) =>
				current?.mode === "new" ? null : { mode: "new" },
			);
		};
		window.addEventListener(OPEN_NEW_CALENDAR_EVENT, toggleNewEventSheet);
		return () =>
			window.removeEventListener(OPEN_NEW_CALENDAR_EVENT, toggleNewEventSheet);
	}, []);

	const excludedCalendarIds =
		calendarFilter.workspaceId === activeWorkspaceId
			? calendarFilter.excludedCalendarIds
			: null;
	const selectedCalendarIds = React.useMemo(() => {
		const selectedIds = new Set<string>();
		for (const calendar of state.calendars) {
			if (!excludedCalendarIds?.has(calendar.id)) {
				selectedIds.add(calendar.id);
			}
		}
		return selectedIds;
	}, [excludedCalendarIds, state.calendars]);
	const filteredEvents = React.useMemo(
		() => filterCalendarEvents(state.events, selectedCalendarIds),
		[selectedCalendarIds, state.events],
	);
	const deferredFilteredEvents = React.useDeferredValue(filteredEvents);
	const isAgendaRenderPending = deferredFilteredEvents !== filteredEvents;
	const calendarProviders = React.useMemo(() => {
		const connectedProviders = new Set(
			state.calendars.map((calendar) => calendar.provider),
		);
		const providerNames: Record<CalendarProvider, string> = {
			google: "Google Calendar",
			yandex: "Yandex Calendar",
		};

		return (["google", "yandex"] as const)
			.filter((provider) => connectedProviders.has(provider))
			.map(
				(provider) =>
					({
						id: provider,
						name: providerNames[provider],
					}) satisfies CalendarProviderOption,
			);
	}, [state.calendars]);
	const defaultCalendarId =
		selectedCalendarIds.size === 1
			? (selectedCalendarIds.values().next().value ?? null)
			: null;
	const handleEventClick = React.useCallback((event: UpcomingCalendarEvent) => {
		setEventPanel({ event, mode: "details" });
	}, []);
	const handleEditEvent = React.useCallback((event: UpcomingCalendarEvent) => {
		setEventPanel({ event, mode: "edit" });
	}, []);
	const toggleCalendar = React.useCallback(
		(calendarId: string) => {
			setCalendarFilter((current) => {
				const excludedCalendarIds =
					current.workspaceId === activeWorkspaceId
						? new Set(current.excludedCalendarIds)
						: new Set<string>();

				if (excludedCalendarIds.has(calendarId)) {
					excludedCalendarIds.delete(calendarId);
				} else {
					excludedCalendarIds.add(calendarId);
				}

				return {
					excludedCalendarIds,
					workspaceId: activeWorkspaceId,
				};
			});
		},
		[activeWorkspaceId],
	);
	const eventSheet = (
		<CalendarEventSheet
			panel={eventPanel}
			onOpenChange={(open) => {
				if (!open) {
					setEventPanel(null);
				}
			}}
			calendars={state.calendars}
			defaultCalendarId={defaultCalendarId}
			desktopSafeTop={isDesktopMac}
			onCreateEvent={createEvent}
			onTakeNote={(event) => {
				setEventPanel(null);
				void onOpenCalendarEventNote(event);
			}}
			onUpdateEvent={handleUpdateEvent}
			workspaceId={activeWorkspaceId}
		/>
	);
	const newCalendarDialog = (
		<CalendarNewCalendarDialog
			open={newCalendarOpen}
			onOpenChange={setNewCalendarOpen}
			onCreateCalendar={createCalendar}
			providers={calendarProviders}
		/>
	);

	if (state.status === "not_connected") {
		return (
			<CalendarPageLayout isDesktopMac={isDesktopMac}>
				<CalendarConnectionEmpty
					onOpenCalendarSettings={onOpenCalendarSettings}
				/>
				{eventSheet}
			</CalendarPageLayout>
		);
	}

	if (state.status === "error" && state.calendars.length === 0) {
		return (
			<CalendarPageLayout isDesktopMac={isDesktopMac}>
				<CalendarError
					onOpenCalendarSettings={onOpenCalendarSettings}
					onRetry={retry}
				/>
				{eventSheet}
			</CalendarPageLayout>
		);
	}

	return (
		<CalendarPageLayout isDesktopMac={isDesktopMac}>
			<CalendarAgenda
				events={deferredFilteredEvents}
				calendars={state.calendars}
				loading={state.status === "loading" || isAgendaRenderPending}
				range={range}
				onToday={() => setAgendaStart(new Date())}
				onPrevious={() => shiftRange(-30)}
				onNext={() => shiftRange(30)}
				onEventClick={handleEventClick}
				onEditEvent={handleEditEvent}
				onDeleteEvent={handleDeleteEvent}
				actions={
					<>
						{state.status === "error" ? (
							<Button variant="ghost" size="sm" onClick={retry}>
								<RefreshCw data-icon="inline-start" />
								Retry
							</Button>
						) : null}
						<CalendarSourceSelect
							calendars={state.calendars}
							selectedCalendarIds={selectedCalendarIds}
							onToggleCalendar={toggleCalendar}
							onCreateCalendar={
								calendarProviders.length > 0
									? () => setNewCalendarOpen(true)
									: null
							}
						/>
					</>
				}
			/>
			{eventSheet}
			{newCalendarDialog}
		</CalendarPageLayout>
	);
}

function CalendarPageLayout({
	children,
	isDesktopMac,
}: {
	children: React.ReactNode;
	isDesktopMac: boolean;
}) {
	return (
		<div className="box-border flex min-h-0 w-full max-w-full min-w-0 flex-1 justify-center px-4 pb-6 md:px-6">
			<div
				className={cn(
					"flex min-h-0 w-full min-w-0 max-w-5xl flex-1 flex-col gap-6",
					isDesktopMac ? "pt-2 md:pt-4" : "pt-0",
				)}
			>
				<section className="mx-auto w-full min-w-0 md:max-w-xl">
					<PageTitle isDesktopMac={isDesktopMac}>Plan ahead</PageTitle>
				</section>
				<section className="mx-auto flex min-h-0 w-full min-w-0 flex-1 md:max-w-xl">
					{children}
				</section>
			</div>
		</div>
	);
}

function CalendarSourceSelect({
	calendars,
	selectedCalendarIds,
	onToggleCalendar,
	onCreateCalendar,
}: {
	calendars: CalendarSource[];
	selectedCalendarIds: ReadonlySet<string>;
	onToggleCalendar: (calendarId: string) => void;
	onCreateCalendar: (() => void) | null;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="w-auto min-w-0 cursor-pointer justify-start gap-2 font-normal"
					aria-label="Calendars"
				>
					<CalendarDays data-icon="inline-start" />
					<span>Calendars</span>
					<ChevronDown data-icon="inline-end" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-52">
				<DropdownMenuGroup>
					{calendars.map((calendar) => (
						<DropdownMenuCheckboxItem
							key={calendar.id}
							checked={selectedCalendarIds.has(calendar.id)}
							className="pr-8 pl-2 [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:right-2 [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:left-auto"
							onSelect={(event) => event.preventDefault()}
							onCheckedChange={() => onToggleCalendar(calendar.id)}
						>
							<CalendarSourceLabel calendar={calendar} />
						</DropdownMenuCheckboxItem>
					))}
				</DropdownMenuGroup>
				{onCreateCalendar ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem onSelect={onCreateCalendar}>
								<Plus />
								New calendar
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function CalendarConnectionEmpty({
	onOpenCalendarSettings,
}: {
	onOpenCalendarSettings: () => void;
}) {
	return (
		<div className="flex min-h-0 flex-1">
			<Empty className="min-h-[520px] flex-1 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<CalendarDays />
					</EmptyMedia>
					<EmptyTitle>Connect a calendar</EmptyTitle>
					<EmptyDescription>
						Link Google Calendar or Yandex Calendar to see your upcoming agenda.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button onClick={onOpenCalendarSettings}>Calendar settings</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}

function CalendarError({
	onOpenCalendarSettings,
	onRetry,
}: {
	onOpenCalendarSettings: () => void;
	onRetry: () => void;
}) {
	return (
		<div className="flex min-h-0 flex-1">
			<Empty className="min-h-[520px] flex-1 border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<CalendarDays />
					</EmptyMedia>
					<EmptyTitle>Couldn&apos;t load calendar</EmptyTitle>
					<EmptyDescription>
						Try reconnecting your calendar, then return to this view.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button onClick={onRetry}>
						<RefreshCw data-icon="inline-start" />
						Retry
					</Button>
					<Button variant="outline" onClick={onOpenCalendarSettings}>
						Calendar settings
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}
