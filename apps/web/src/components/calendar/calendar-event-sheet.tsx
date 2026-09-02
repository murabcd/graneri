"use client";

import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "@workspace/ui/components/sheet";
import { useOptionalSidebarShell } from "@workspace/ui/components/sidebar";
import { useIsMobile } from "@workspace/ui/hooks/use-is-mobile";
import {
	APP_SIDEBAR_COLLAPSED_WIDTH,
	APP_SIDEBAR_EXPANDED_WIDTH,
	DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
	DESKTOP_DOCKED_PANEL_MAX_WIDTH,
	DESKTOP_DOCKED_PANEL_MIN_WIDTH,
	MOBILE_DOCKED_PANEL_MIN_WIDTH,
} from "@workspace/ui/lib/panel-dimensions";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import { CalendarEventDetailsPanel } from "@/components/calendar/calendar-event-details-panel";
import type { CalendarEventCreation } from "@/components/calendar/calendar-event-draft";
import { CalendarEventEditorPanel } from "@/components/calendar/calendar-event-editor-panel";
import type { CalendarSource } from "@/components/calendar/calendar-view-model";
import { DesktopDockedSidePanel } from "@/components/layout/docked-side-panel";
import {
	ResizableSidePanelHandle,
	useResizableSidePanel,
} from "@/components/layout/resizable-side-panel";
import { useDesktopPanelPin } from "@/components/layout/use-desktop-panel-pin";
import {
	useDockedPanelInset,
	useDockedPanelOverlayWidth,
} from "@/components/layout/use-docked-panel-widths";
import type { Id } from "../../../../../convex/_generated/dataModel";

export type CalendarEventPanelState =
	| {
			mode: "new";
	  }
	| {
			event: UpcomingCalendarEvent;
			mode: "details" | "edit";
	  };

type CalendarEventSheetProps = {
	calendars: CalendarSource[];
	defaultCalendarId: string | null;
	desktopSafeTop?: boolean;
	onOpenChange: (open: boolean) => void;
	onCreateEvent: (event: CalendarEventCreation) => Promise<void>;
	onTakeNote: (event: UpcomingCalendarEvent) => void;
	onUpdateEvent: (
		event: UpcomingCalendarEvent,
		update: CalendarEventCreation,
	) => Promise<void>;
	panel: CalendarEventPanelState | null;
	workspaceId: Id<"workspaces"> | null;
};

const PANEL_STORAGE_KEY_DESKTOP = "graneri.calendar-event-panel-width.desktop";
const PANEL_STORAGE_KEY_MOBILE = "graneri.calendar-event-panel-width.mobile";
const PANEL_PINNED_STORAGE_KEY = "graneri.calendar-event-panel-pinned.desktop";

function CalendarEventPanelContent({
	calendars,
	defaultCalendarId,
	desktopSafeTop,
	event,
	isMobile,
	isPinned,
	onClose,
	onCreateEvent,
	onTakeNote,
	onTogglePinned,
	onUpdateEvent,
	panelMode,
	workspaceId,
}: Omit<CalendarEventSheetProps, "onOpenChange" | "panel"> & {
	desktopSafeTop: boolean;
	event: UpcomingCalendarEvent | null;
	isMobile: boolean;
	isPinned: boolean;
	onClose: () => void;
	onTogglePinned: () => void;
	panelMode: CalendarEventPanelState["mode"] | null;
}) {
	if (event && panelMode === "details") {
		return (
			<CalendarEventDetailsPanel
				calendars={calendars}
				desktopSafeTop={desktopSafeTop}
				event={event}
				isMobile={isMobile}
				isPinned={isPinned}
				onClose={onClose}
				onTakeNote={onTakeNote}
				onTogglePinned={onTogglePinned}
			/>
		);
	}
	if (!workspaceId) {
		return null;
	}
	return (
		<CalendarEventEditorPanel
			calendars={calendars}
			defaultCalendarId={defaultCalendarId}
			desktopSafeTop={desktopSafeTop}
			event={event}
			isMobile={isMobile}
			isPinned={isPinned}
			onClose={onClose}
			onSaveEvent={(creation) =>
				event ? onUpdateEvent(event, creation) : onCreateEvent(creation)
			}
			onTogglePinned={onTogglePinned}
			workspaceId={workspaceId}
		/>
	);
}

function MobileCalendarEventSheet({
	event,
	isResizing,
	onOpenChange,
	onResizeKeyDown,
	onResizeStart,
	open,
	panelContent,
	panelWidth,
}: {
	event: UpcomingCalendarEvent | null;
	isResizing: boolean;
	onOpenChange: (open: boolean) => void;
	onResizeKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
	onResizeStart: (event: React.PointerEvent<HTMLElement>) => void;
	open: boolean;
	panelContent: React.ReactNode;
	panelWidth: number;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			{open ? (
				<SheetContent
					className="group/docked-sheet gap-0 border-l bg-background p-0 shadow-none data-[side=right]:sm:max-w-none"
					showCloseButton={false}
					side="right"
					style={{ width: panelWidth, maxWidth: "100vw" }}
				>
					<SheetTitle className="sr-only">
						{event?.title ?? "New event"}
					</SheetTitle>
					<SheetDescription className="sr-only">
						{event
							? "View the details for this calendar event."
							: "Add the details for your calendar event."}
					</SheetDescription>
					<ResizableSidePanelHandle
						className="opacity-0 transition-opacity duration-150 group-hover/docked-sheet:opacity-100 group-focus-within/docked-sheet:opacity-100"
						isResizing={isResizing}
						label="Resize calendar event panel"
						onKeyDown={onResizeKeyDown}
						onPointerDown={onResizeStart}
						panelWidth={panelWidth}
						side="right"
					/>
					{panelContent}
				</SheetContent>
			) : null}
		</Sheet>
	);
}

export function CalendarEventSheet({
	calendars,
	defaultCalendarId,
	desktopSafeTop = false,
	onCreateEvent,
	onOpenChange,
	onTakeNote,
	onUpdateEvent,
	panel,
	workspaceId,
}: CalendarEventSheetProps) {
	const open = panel !== null;
	const event = panel && panel.mode !== "new" ? panel.event : null;
	const sidebarShell = useOptionalSidebarShell();
	const isMobile = useIsMobile();
	const { isPinned, togglePinned } = useDesktopPanelPin({
		storageKey: PANEL_PINNED_STORAGE_KEY,
	});
	const { handleResizeKeyDown, handleResizeStart, isResizing, panelWidth } =
		useResizableSidePanel({
			isMobile,
			side: "right",
			desktopStorageKey: PANEL_STORAGE_KEY_DESKTOP,
			mobileStorageKey: PANEL_STORAGE_KEY_MOBILE,
			defaultDesktopWidth: DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
			desktopMinWidth: DESKTOP_DOCKED_PANEL_MIN_WIDTH,
			desktopMaxWidth: DESKTOP_DOCKED_PANEL_MAX_WIDTH,
			mobileMinWidth: MOBILE_DOCKED_PANEL_MIN_WIDTH,
		});
	const leftSidebarReservedWidth =
		sidebarShell?.state === "collapsed"
			? APP_SIDEBAR_COLLAPSED_WIDTH
			: APP_SIDEBAR_EXPANDED_WIDTH;
	const eventKey = event
		? `${event.provider}:${event.providerEventId}:${event.recurrenceId ?? ""}`
		: null;

	useDockedPanelInset({
		side: "right",
		isMobile,
		isPinned,
		open,
		panelWidth,
	});
	useDockedPanelOverlayWidth({
		side: "right",
		isMobile,
		isPinned,
		open,
		panelWidth,
	});

	const panelContent = (
		<CalendarEventPanelContent
			key={`${open ? "open" : "closed"}:${eventKey ?? "new"}`}
			calendars={calendars}
			defaultCalendarId={defaultCalendarId}
			desktopSafeTop={desktopSafeTop}
			event={event}
			isMobile={isMobile}
			isPinned={isPinned}
			onClose={() => onOpenChange(false)}
			onCreateEvent={onCreateEvent}
			onTakeNote={onTakeNote}
			onTogglePinned={togglePinned}
			onUpdateEvent={onUpdateEvent}
			panelMode={panel?.mode ?? null}
			workspaceId={workspaceId}
		/>
	);
	const panelName = event
		? panel?.mode === "edit"
			? "event editor"
			: "event details"
		: "new event";

	if (!isMobile) {
		return (
			<DesktopDockedSidePanel
				side="right"
				open={open}
				isPinned={isPinned}
				panelWidth={panelWidth}
				dismissLeadingOffset={`${leftSidebarReservedWidth}px`}
				desktopSafeTop={desktopSafeTop}
				onOpenChange={onOpenChange}
				panelName={panelName}
				resizeLabel="Resize calendar event panel"
				isResizing={isResizing}
				onResizeStart={handleResizeStart}
				onResizeKeyDown={handleResizeKeyDown}
			>
				{panelContent}
			</DesktopDockedSidePanel>
		);
	}

	return (
		<MobileCalendarEventSheet
			event={event}
			isResizing={isResizing}
			onOpenChange={onOpenChange}
			onResizeKeyDown={handleResizeKeyDown}
			onResizeStart={handleResizeStart}
			open={open}
			panelContent={panelContent}
			panelWidth={panelWidth}
		/>
	);
}
