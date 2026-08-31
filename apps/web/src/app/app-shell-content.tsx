import { Button } from "@workspace/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import * as React from "react";
import type {
	AppUser,
	UpcomingCalendarEvent,
	UpcomingCalendarState,
} from "@/app/app-types";
import { HomeView, SharedView } from "@/app/home-shared-views";
import { ProjectView } from "@/app/project-view";
import type { AutomationListItem } from "@/components/automations/automation-types";
import { AutomationsPageEntry } from "@/components/automations/automations-page-entry";
import { CalendarPageEntry } from "@/components/calendar/calendar-page-entry";
import { ChatPageEntry } from "@/components/chat/chat-page-entry";
import type { NoteEditorActionsStore } from "@/components/note/note-editor-actions-store";
import { NotePageEntry } from "@/components/note/note-page-entry";
import type { ChatPluginPrefill } from "@/lib/chat-plugin-prefill";
import type { NoteRecord } from "@/lib/note-types";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

type NoteListViewProps = {
	isDesktopMac: boolean;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle: string;
	user: AppUser;
	onOpenNote: (noteId: Id<"notes">) => void;
	onNoteTrashed: (noteId: Id<"notes">) => void;
};

export type AppShellContentView =
	| {
			kind: "resolving";
	  }
	| ({
			kind: "home";
			currentDate: Date;
			currentDayOfMonth: number;
			currentMonthLabel: string;
			currentWeekdayLabel: string;
			upcomingCalendar: UpcomingCalendarState;
			notes: Array<Doc<"notes">> | undefined;
			onCreateNote: () => void;
			onOpenCalendarEventNote: (
				event: UpcomingCalendarEvent,
				options?: {
					autoStartCapture?: boolean;
					stopCaptureWhenMeetingEnds?: boolean;
				},
			) => Promise<void> | void;
			onOpenCalendarSettings: () => void;
	  } & NoteListViewProps)
	| {
			kind: "calendar";
			accountId: string | null;
			isDesktopMac: boolean;
			onOpenCalendarEventNote: (
				event: UpcomingCalendarEvent,
			) => Promise<void> | void;
			onOpenCalendarSettings: () => void;
	  }
	| ({
			kind: "shared";
			sharedNotes: Array<Doc<"notes">> | undefined;
	  } & NoteListViewProps)
	| ({
			kind: "project";
			notes: Array<Doc<"notes">> | undefined;
			project: Doc<"projects">;
			onCreateNote: () => void;
	  } & NoteListViewProps)
	| {
			kind: "automation";
			automations: AutomationListItem[] | undefined;
			isDesktopMac: boolean;
			onCreateAutomation: () => void;
			onDeleteAutomation: (automationId: Id<"automations">) => void;
			onEditAutomation: (automationId: Id<"automations">) => void;
			onOpenAutomation: (automation: AutomationListItem) => void;
			onRunAutomationNow: (automationId: Id<"automations">) => Promise<void>;
			onToggleAutomationPaused: (automationId: Id<"automations">) => void;
	  }
	| {
			kind: "note";
			currentNoteId: Id<"notes"> | null;
			currentNoteTitle: string;
			noteCaptureRequestId: string | null;
			selectedNote: NoteRecord | null | undefined;
			user: AppUser;
			isDesktopMac: boolean;
			onAutoStartNoteCaptureHandled: () => void;
			onNoteCommentsOpenChange: (opener: (() => void) | null) => void;
			noteEditorActionsStore: NoteEditorActionsStore;
			onNoteTitleChange: (title: string) => void;
			shouldAutoStartNoteCapture: boolean;
			shouldStopNoteCaptureWhenMeetingEnds: boolean;
	  }
	| {
			kind: "chat";
			activeStreamingChatIds: ReadonlySet<string>;
			automations: AutomationListItem[] | undefined;
			chatComposerId: string;
			chatPluginPrefill: ChatPluginPrefill | null;
			chats: Array<Doc<"chats">> | undefined;
			currentChatId: string | null;
			isDesktopMac: boolean;
			onChatPersisted?: (chatId: string) => void;
			onChatRemoved: (chatId: string) => void;
			onCreateChatAutomation: (chatId: string) => void;
			onCreateNoteFromChatResponse: (request: {
				chatId: string;
				content: string;
				messageId: string;
				title: string;
			}) => Promise<"created" | undefined> | "created" | undefined;
			onOpenChat: (chatId: string) => void;
			onOpenConnectionsSettings: () => void;
	  }
	| {
			kind: "notFound";
			onGoHome: () => void;
	  };

export const AppShellContent = React.memo(function AppShellContent({
	view,
}: {
	view: AppShellContentView;
}) {
	const noteViewScrollRef = React.useRef<HTMLDivElement | null>(null);

	if (view.kind === "resolving") {
		return <div className="flex flex-1" aria-hidden="true" />;
	}

	if (view.kind === "notFound") {
		return <NotFoundView onGoHome={view.onGoHome} />;
	}

	if (view.kind === "home") {
		return (
			<ContentScrollArea key="home" variant="list">
				<HomeView
					currentDate={view.currentDate}
					currentDayOfMonth={view.currentDayOfMonth}
					currentMonthLabel={view.currentMonthLabel}
					currentWeekdayLabel={view.currentWeekdayLabel}
					upcomingCalendar={view.upcomingCalendar}
					notes={view.notes}
					currentNoteId={view.currentNoteId}
					currentNoteTitle={view.currentNoteTitle}
					currentUser={view.user}
					isDesktopMac={view.isDesktopMac}
					onOpenNote={view.onOpenNote}
					onNoteTrashed={view.onNoteTrashed}
					onCreateNote={view.onCreateNote}
					onOpenCalendarEventNote={view.onOpenCalendarEventNote}
					onOpenCalendarSettings={view.onOpenCalendarSettings}
				/>
			</ContentScrollArea>
		);
	}

	if (view.kind === "calendar") {
		return (
			<CalendarPageEntry
				accountId={view.accountId}
				isDesktopMac={view.isDesktopMac}
				onOpenCalendarEventNote={view.onOpenCalendarEventNote}
				onOpenCalendarSettings={view.onOpenCalendarSettings}
			/>
		);
	}

	if (view.kind === "shared") {
		return (
			<ContentScrollArea key="shared" variant="list">
				<SharedView
					sharedNotes={view.sharedNotes}
					currentNoteId={view.currentNoteId}
					currentNoteTitle={view.currentNoteTitle}
					currentUser={view.user}
					isDesktopMac={view.isDesktopMac}
					onOpenNote={view.onOpenNote}
					onNoteTrashed={view.onNoteTrashed}
				/>
			</ContentScrollArea>
		);
	}

	if (view.kind === "project") {
		return (
			<ContentScrollArea key={`project:${view.project._id}`} variant="list">
				<ProjectView
					project={view.project}
					notes={view.notes}
					currentNoteId={view.currentNoteId}
					currentNoteTitle={view.currentNoteTitle}
					currentUser={view.user}
					isDesktopMac={view.isDesktopMac}
					onOpenNote={view.onOpenNote}
					onNoteTrashed={view.onNoteTrashed}
					onCreateNote={view.onCreateNote}
				/>
			</ContentScrollArea>
		);
	}

	if (view.kind === "automation") {
		return (
			<ContentScrollArea key="automation">
				<AutomationsPageEntry
					automations={view.automations}
					isDesktopMac={view.isDesktopMac}
					onCreateAutomation={view.onCreateAutomation}
					onDeleteAutomation={view.onDeleteAutomation}
					onEditAutomation={view.onEditAutomation}
					onOpenAutomation={view.onOpenAutomation}
					onRunAutomationNow={view.onRunAutomationNow}
					onToggleAutomationPaused={view.onToggleAutomationPaused}
				/>
			</ContentScrollArea>
		);
	}

	if (view.kind === "note") {
		return (
			<ContentScrollArea
				key={`note:${view.currentNoteId ?? "new"}`}
				viewportRef={noteViewScrollRef}
			>
				<NotePageEntry
					key={view.currentNoteId ?? "new"}
					autoStartTranscription={view.shouldAutoStartNoteCapture}
					currentUser={view.user}
					isDesktopMac={view.isDesktopMac}
					noteId={view.currentNoteId}
					noteCaptureRequestId={view.noteCaptureRequestId}
					note={view.selectedNote}
					externalTitle={view.currentNoteTitle}
					onAutoStartTranscriptionHandled={view.onAutoStartNoteCaptureHandled}
					onCommentsOpenChange={view.onNoteCommentsOpenChange}
					onTitleChange={view.onNoteTitleChange}
					editorActionsStore={view.noteEditorActionsStore}
					scrollParentRef={noteViewScrollRef}
					stopTranscriptionWhenMeetingEnds={
						view.shouldStopNoteCaptureWhenMeetingEnds
					}
				/>
			</ContentScrollArea>
		);
	}

	return (
		<ChatPageEntry
			key={view.chatComposerId}
			chatId={view.chatComposerId}
			pluginPrefill={view.chatPluginPrefill}
			onChatPersisted={view.onChatPersisted}
			chats={view.chats ?? []}
			isChatsLoading={view.chats === undefined}
			activeStreamingChatIds={view.activeStreamingChatIds}
			activeChatId={view.currentChatId}
			onOpenChat={view.onOpenChat}
			onChatRemoved={view.onChatRemoved}
			isDesktopMac={view.isDesktopMac}
			onOpenConnectionsSettings={view.onOpenConnectionsSettings}
			onCreateNoteFromResponse={view.onCreateNoteFromChatResponse}
			automations={view.automations}
			onAddAutomation={view.onCreateChatAutomation}
		/>
	);
});

function ContentScrollArea({
	children,
	variant = "default",
	viewportRef,
}: {
	children: React.ReactNode;
	variant?: "default" | "list";
	viewportRef?: React.Ref<HTMLDivElement>;
}) {
	return (
		<ScrollArea
			className="min-h-0 flex-1"
			viewportClassName={
				variant === "list"
					? "overscroll-contain overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full [&>div]:!max-w-full"
					: "overscroll-contain"
			}
			viewportRef={viewportRef}
		>
			{children}
		</ScrollArea>
	);
}

function NotFoundView({ onGoHome }: { onGoHome: () => void }) {
	return (
		<div className="flex flex-1 items-center justify-center px-8 py-10">
			<Empty className="max-w-lg border-none">
				<EmptyHeader>
					<EmptyTitle>404 - Not Found</EmptyTitle>
					<EmptyDescription>
						The page you&apos;re looking for doesn&apos;t exist. Use the sidebar
						to search or go back home.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button onClick={onGoHome} size="sm">
						Go to Home
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}
