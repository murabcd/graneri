import { openDesktopExternalUrl } from "@workspace/platform/desktop";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import { CalendarClock, FileText, UsersRound } from "lucide-react";
import * as React from "react";
import type {
	AppUser,
	UpcomingCalendarEvent,
	UpcomingCalendarState,
} from "@/app/app-types";
import {
	formatUpcomingEventMeta,
	getUpcomingCalendarIndicator,
	isUpcomingEventLive,
	isUpcomingEventToday,
} from "@/app/location";
import { NoteCatalogLoadMore, NotesList } from "@/app/note-list";
import { PageTitle } from "@/components/layout/page-title";
import { useRecordingNoteId } from "@/hooks/use-transcription-session";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

const homeCalendarSkeletonTitleWidths = ["w-3/5", "w-2/3", "w-1/2"] as const;

const getVisibleUpcomingMeetings = (
	events: UpcomingCalendarEvent[],
	currentDate: Date,
) => {
	const visibleEvents: UpcomingCalendarEvent[] = [];
	for (const event of events) {
		if (event.isMeeting && isUpcomingEventToday(event, currentDate)) {
			visibleEvents.push(event);
			if (visibleEvents.length === 5) {
				break;
			}
		}
	}
	return visibleEvents;
};

function HomeCalendarEventListSkeleton() {
	return (
		<div
			aria-label="Loading upcoming meetings"
			className="w-full p-1"
			role="status"
		>
			<div className="space-y-1.5">
				{homeCalendarSkeletonTitleWidths.map((titleWidth) => (
					<div
						key={titleWidth}
						aria-hidden="true"
						className="flex items-center gap-3 rounded-lg px-3 py-2"
					>
						<Skeleton className="h-8 w-1 shrink-0 rounded-full bg-muted-foreground/20" />
						<div className="min-w-0 flex-1">
							<div className="flex items-center justify-between gap-4">
								<div className="min-w-0 flex-1 space-y-1.5">
									<Skeleton
										className={cn("h-3.5 bg-muted-foreground/20", titleWidth)}
									/>
									<Skeleton className="h-2 w-20 bg-muted-foreground/10" />
								</div>
								<Skeleton className="h-7 w-20 shrink-0 rounded-lg bg-muted-foreground/15" />
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

const getUpcomingCalendarEmptyCopy = (
	status: UpcomingCalendarState["status"],
) => {
	if (status === "not_connected") {
		return {
			description: "Link your calendar in settings to see upcoming meetings.",
			title: "Connect a calendar",
		};
	}
	if (status === "error") {
		return {
			description: "Try reconnecting your calendars or refresh the app.",
			title: "Couldn’t load calendar",
		};
	}
	return {
		description: "Check your visible calendars for today",
		title: "No upcoming events today",
	};
};

function HomeUpcomingEvents({
	currentDate,
	isResolving,
	onOpenCalendarEventNote,
	onOpenCalendarSettings,
	onOpenMeetingLink,
	status,
	visibleEvents,
}: {
	currentDate: Date;
	isResolving: boolean;
	onOpenCalendarEventNote: (
		event: UpcomingCalendarEvent,
		options: {
			autoStartCapture: boolean;
			stopCaptureWhenMeetingEnds: boolean;
		},
	) => Promise<void> | void;
	onOpenCalendarSettings: () => void;
	onOpenMeetingLink: (url: string) => void;
	status: UpcomingCalendarState["status"];
	visibleEvents: UpcomingCalendarEvent[];
}) {
	if (isResolving) {
		return <HomeCalendarEventListSkeleton />;
	}
	if (visibleEvents.length === 0) {
		const emptyCopy = getUpcomingCalendarEmptyCopy(status);
		return (
			<Empty className="h-full rounded-none border-0 p-4">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<CalendarClock className="size-4" />
					</EmptyMedia>
					<EmptyTitle>{emptyCopy.title}</EmptyTitle>
					<EmptyDescription>{emptyCopy.description}</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button variant="outline" onClick={onOpenCalendarSettings}>
						Calendar settings
					</Button>
				</EmptyContent>
			</Empty>
		);
	}

	return (
		<div className="w-full p-1">
			<div className="space-y-1.5">
				{visibleEvents.map((event) => {
					const isLive = isUpcomingEventLive(event, currentDate);
					const hasStarted =
						new Date(event.startAt).getTime() <= currentDate.getTime();
					return (
						<div
							className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/40"
							key={`${event.id}:${event.startAt}`}
						>
							<div
								className={cn(
									"h-8 w-1 shrink-0 rounded-full bg-status-planned",
									isLive && "bg-status-live",
								)}
							/>
							<div className="min-w-0 flex-1">
								<div className="flex items-center justify-between gap-4">
									<div className="min-w-0">
										<p className="truncate text-sm font-medium text-foreground">
											{event.title}
										</p>
										<p
											className={cn(
												"mt-0.5 text-xs text-muted-foreground",
												isLive && "text-status-live",
											)}
										>
											{formatUpcomingEventMeta(event, currentDate)}
										</p>
									</div>
									<Button
										className="shrink-0"
										onClick={() => {
											void onOpenCalendarEventNote(event, {
												autoStartCapture: hasStarted,
												stopCaptureWhenMeetingEnds: true,
											});
											if (event.meetingUrl) {
												onOpenMeetingLink(event.meetingUrl);
											}
										}}
										size="sm"
										type="button"
										variant="default"
									>
										{event.meetingUrl ? "Start now" : "Open note"}
									</Button>
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

export function HomeView({
	currentDate,
	currentDayOfMonth,
	currentMonthLabel,
	currentWeekdayLabel,
	upcomingCalendar,
	notes,
	currentNoteId,
	currentNoteTitle,
	currentUser,
	isDesktopMac,
	onOpenNote,
	onNoteTrashed,
	onCreateNote,
	onOpenCalendarEventNote,
	onOpenCalendarSettings,
	hasMoreNotes,
	isLoadingMoreNotes,
	onLoadMoreNotes,
}: {
	currentDate: Date;
	currentDayOfMonth: number;
	currentMonthLabel: string;
	currentWeekdayLabel: string;
	upcomingCalendar: UpcomingCalendarState;
	notes: Array<Doc<"notes">> | undefined;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle: string;
	currentUser: AppUser;
	isDesktopMac: boolean;
	onOpenNote: (noteId: Id<"notes">) => void;
	onNoteTrashed: (noteId: Id<"notes">) => void;
	onCreateNote: () => void;
	onOpenCalendarEventNote: (
		event: UpcomingCalendarEvent,
		options?: {
			autoStartCapture?: boolean;
			stopCaptureWhenMeetingEnds?: boolean;
		},
	) => Promise<void> | void;
	onOpenCalendarSettings: () => void;
	hasMoreNotes: boolean;
	isLoadingMoreNotes: boolean;
	onLoadMoreNotes: () => void;
}) {
	const visibleUpcomingEvents = getVisibleUpcomingMeetings(
		upcomingCalendar.events,
		currentDate,
	);
	const isResolvingUpcomingCalendar =
		upcomingCalendar.status === "checking" &&
		visibleUpcomingEvents.length === 0;
	const hasLiveUpcomingMeeting = visibleUpcomingEvents.some((event) =>
		isUpcomingEventLive(event, currentDate),
	);
	const upcomingCalendarIndicator = getUpcomingCalendarIndicator({
		hasLiveMeeting: hasLiveUpcomingMeeting,
		status: upcomingCalendar.status,
	});
	const recordingNoteId = useRecordingNoteId();

	const openMeetingLink = React.useCallback(async (url: string) => {
		if (await openDesktopExternalUrl(url)) {
			return;
		}

		window.open(url, "_blank", "noopener,noreferrer");
	}, []);

	return (
		<div
			data-desktop-nonselectable
			className="box-border flex w-full max-w-full min-w-0 justify-center px-4 pb-6 md:px-6"
		>
			<div
				className={cn(
					"flex w-full min-w-0 max-w-5xl flex-col gap-6",
					isDesktopMac ? "pt-2.5" : "pt-0",
				)}
			>
				<section className="mx-auto w-full min-w-0 space-y-6 md:max-w-xl">
					<PageTitle isDesktopMac={isDesktopMac}>Coming up</PageTitle>
					<Card className="max-w-full overflow-hidden rounded-lg border-border py-0 shadow-sm">
						<CardContent className="p-0">
							<div className="grid min-h-[152px] md:grid-cols-[184px_minmax(0,1fr)]">
								<div className="flex items-start border-b border-border/60 px-5 py-4 md:border-b-0 md:border-r">
									<div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
										<div className="row-span-2 text-5xl leading-none tracking-tight tabular-nums">
											{currentDayOfMonth}
										</div>
										<div className="flex min-w-0 items-center gap-2 pt-1 text-base leading-none">
											<span>{currentMonthLabel}</span>
											<output
												aria-label={`Calendar status: ${upcomingCalendarIndicator.label}`}
												className="inline-flex"
											>
												<span
													className={cn(
														"size-2 rounded-full",
														upcomingCalendarIndicator.dotClassName,
													)}
												/>
											</output>
										</div>
										<p className="text-base leading-none text-muted-foreground">
											{currentWeekdayLabel}
										</p>
									</div>
								</div>
								<div className="flex min-h-[152px] w-full items-start justify-center p-3">
									<HomeUpcomingEvents
										currentDate={currentDate}
										isResolving={isResolvingUpcomingCalendar}
										onOpenCalendarEventNote={onOpenCalendarEventNote}
										onOpenCalendarSettings={onOpenCalendarSettings}
										onOpenMeetingLink={(url) => void openMeetingLink(url)}
										status={upcomingCalendar.status}
										visibleEvents={visibleUpcomingEvents}
									/>
								</div>
							</div>
						</CardContent>
					</Card>
				</section>

				<section className="flex min-w-0 justify-center py-8">
					{notes === undefined ? (
						<div
							className="min-h-[184px] w-full md:max-w-xl"
							aria-hidden="true"
						/>
					) : notes.length > 0 ? (
						<div className="w-full md:max-w-xl">
							<NotesList
								notes={notes}
								activeNoteId={currentNoteId}
								activeNoteTitle={currentNoteTitle}
								recordingNoteId={recordingNoteId}
								currentUser={currentUser}
								onOpenNote={onOpenNote}
								onNoteTrashed={onNoteTrashed}
							/>
							<NoteCatalogLoadMore
								hasMore={hasMoreNotes}
								isLoading={isLoadingMoreNotes}
								onLoadMore={onLoadMoreNotes}
							/>
						</div>
					) : (
						<Empty className="md:max-w-xl">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<FileText className="size-4" />
								</EmptyMedia>
								<EmptyTitle>Take your first note</EmptyTitle>
								<EmptyDescription>
									Your meeting notes will appear here
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button onClick={onCreateNote}>New note</Button>
							</EmptyContent>
						</Empty>
					)}
				</section>
			</div>
		</div>
	);
}

export function SharedView({
	sharedNotes,
	currentNoteId,
	currentNoteTitle,
	currentUser,
	isDesktopMac,
	onOpenNote,
	onNoteTrashed,
	hasMoreNotes,
	isLoadingMoreNotes,
	onLoadMoreNotes,
}: {
	sharedNotes: Array<Doc<"notes">> | undefined;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle: string;
	currentUser: AppUser;
	isDesktopMac: boolean;
	onOpenNote: (noteId: Id<"notes">) => void;
	onNoteTrashed: (noteId: Id<"notes">) => void;
	hasMoreNotes: boolean;
	isLoadingMoreNotes: boolean;
	onLoadMoreNotes: () => void;
}) {
	return (
		<div
			data-desktop-nonselectable
			className="box-border flex w-full max-w-full min-w-0 justify-center px-4 pb-6 md:px-6"
		>
			<div
				className={cn(
					"flex w-full min-w-0 max-w-5xl flex-col gap-6",
					isDesktopMac ? "pt-2 md:pt-4" : "pt-0",
				)}
			>
				<section className="mx-auto w-full min-w-0 space-y-6 md:max-w-xl">
					<PageTitle isDesktopMac={isDesktopMac}>Shared with others</PageTitle>
					<Card className="max-w-full overflow-hidden rounded-lg border-border py-0 shadow-sm">
						<CardContent
							aria-busy={sharedNotes === undefined}
							className="flex items-start justify-between gap-4 p-5"
						>
							<div>
								{sharedNotes !== undefined ? (
									<p className="text-5xl leading-none tracking-tight tabular-nums">
										{sharedNotes.length}
										{hasMoreNotes ? "+" : ""}
									</p>
								) : null}
							</div>
						</CardContent>
					</Card>
				</section>
				<section className="flex min-w-0 justify-center py-4">
					{sharedNotes === undefined ? null : sharedNotes.length > 0 ? (
						<div className="w-full md:max-w-xl">
							<SharedNotesList
								notes={sharedNotes}
								activeNoteId={currentNoteId}
								activeNoteTitle={currentNoteTitle}
								currentUser={currentUser}
								onOpenNote={onOpenNote}
								onNoteTrashed={onNoteTrashed}
							/>
							<NoteCatalogLoadMore
								hasMore={hasMoreNotes}
								isLoading={isLoadingMoreNotes}
								onLoadMore={onLoadMoreNotes}
							/>
						</div>
					) : (
						<div className="w-full md:max-w-xl">
							<Empty>
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<UsersRound className="size-4" />
									</EmptyMedia>
									<EmptyTitle>
										{hasMoreNotes
											? "No shared notes loaded"
											: "No shared notes yet"}
									</EmptyTitle>
									<EmptyDescription>
										{hasMoreNotes
											? "Load older notes to keep looking"
											: "Share a note with someone else"}
									</EmptyDescription>
								</EmptyHeader>
							</Empty>
							<NoteCatalogLoadMore
								hasMore={hasMoreNotes}
								isLoading={isLoadingMoreNotes}
								onLoadMore={onLoadMoreNotes}
							/>
						</div>
					)}
				</section>
			</div>
		</div>
	);
}

function SharedNotesList({
	notes,
	activeNoteId,
	activeNoteTitle,
	currentUser,
	onOpenNote,
	onNoteTrashed,
}: {
	notes: Array<Doc<"notes">>;
	activeNoteId: Id<"notes"> | null;
	activeNoteTitle: string;
	currentUser: AppUser;
	onOpenNote: (noteId: Id<"notes">) => void;
	onNoteTrashed: (noteId: Id<"notes">) => void;
}) {
	return (
		<NotesList
			notes={notes}
			activeNoteId={activeNoteId}
			activeNoteTitle={activeNoteTitle}
			recordingNoteId={null}
			currentUser={currentUser}
			onOpenNote={onOpenNote}
			onNoteTrashed={onNoteTrashed}
		/>
	);
}
