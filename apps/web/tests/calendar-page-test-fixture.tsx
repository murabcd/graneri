import { render } from "@testing-library/react";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { getFunctionName } from "convex/server";
import { vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { CalendarPage } from "../src/components/calendar/calendar-page";
import { OPEN_NEW_CALENDAR_EVENT } from "../src/components/calendar/calendar-page-events";
import { ActiveWorkspaceProvider } from "../src/hooks/active-workspace-provider";

const {
	createCalendar,
	createCalendarEvent,
	deleteCalendar,
	deleteCalendarEvent,
	listCalendarEvents,
	removeCalendarEvent,
	setDefaultCalendar,
	updateCalendar,
	updateCalendarEvent,
} = vi.hoisted(() => ({
	createCalendar: vi.fn(),
	createCalendarEvent: vi.fn(),
	deleteCalendar: vi.fn(),
	deleteCalendarEvent: vi.fn(),
	listCalendarEvents: vi.fn(),
	removeCalendarEvent: vi.fn(),
	setDefaultCalendar: vi.fn(),
	updateCalendar: vi.fn(),
	updateCalendarEvent: vi.fn(),
}));

export const getCalendarPageTestMocks = () => ({
	createCalendar,
	createCalendarEvent,
	deleteCalendar,
	deleteCalendarEvent,
	listCalendarEvents,
	removeCalendarEvent,
	setDefaultCalendar,
	updateCalendar,
	updateCalendarEvent,
});

vi.mock("convex/react", () => ({
	useAction: (reference: never) => {
		const functionName = getFunctionName(reference);

		if (functionName === "calendar:createCalendar") {
			return createCalendar;
		}

		if (functionName === "calendar:createCalendarEvent") {
			return createCalendarEvent;
		}
		if (functionName === "calendar:deleteCalendar") {
			return deleteCalendar;
		}
		if (functionName === "calendar:updateCalendar") {
			return updateCalendar;
		}
		if (functionName === "calendar:setDefaultCalendar") {
			return setDefaultCalendar;
		}

		if (functionName === "calendar:updateCalendarEvent") {
			return updateCalendarEvent;
		}
		if (functionName === "calendar:removeCalendarEvent") {
			return removeCalendarEvent;
		}

		return functionName === "calendar:deleteCalendarEvent"
			? deleteCalendarEvent
			: listCalendarEvents;
	},
	useQuery: (reference: never) => {
		const functionName = getFunctionName(reference);

		if (functionName === "calendarPreferences:get") {
			return {
				showGoogleCalendar: true,
				showGoogleDrive: false,
				showYandexCalendar: false,
			};
		}

		return functionName === "people:listForPicker"
			? {
					hasMore: false,
					people: [
						{ displayName: "Alina Petrova", email: "alina@acme.com" },
						{ displayName: "Mark Stone", email: "mark@acme.com" },
					],
				}
			: null;
	},
}));

export const readyCalendar = {
	status: "ready" as const,
	calendars: [
		{
			canCreateEvents: true,
			canEdit: true,
			canSetDefault: false,
			color: "#3b82f6",
			id: "work",
			name: "Work",
			provider: "google" as const,
			removalMode: "delete" as const,
			requiresEventMove: true,
		},
	],
	events: [
		{
			attendees: [
				{
					displayName: "Murad Abdulkadyrov",
					email: "murad@example.com",
					isOrganizer: true,
					isSelf: true,
					responseStatus: "accepted" as const,
				},
				{
					displayName: "Alina Petrova",
					email: "alina@acme.com",
					isOrganizer: false,
					isSelf: false,
					responseStatus: "tentative" as const,
				},
				{
					email: "mark@acme.com",
					isOrganizer: false,
					isSelf: false,
					responseStatus: "needs_action" as const,
				},
				{
					displayName: "Priya Shah",
					email: "priya@example.com",
					isOrganizer: false,
					isSelf: false,
					responseStatus: "declined" as const,
				},
			],
			canDelete: true,
			canEdit: true,
			guestPermissions: "manage",
			canMove: true,
			canRemove: false,
			id: "event-1",
			calendarId: "work",
			calendarName: "Work",
			title: "Planning",
			startAt: "2026-07-27T10:00:00.000Z",
			endAt: "2026-07-27T11:00:00.000Z",
			isAllDay: false,
			isMeeting: true,
			isRecurring: false,
			provider: "google" as const,
			providerEventId: "provider-event-1",
		},
	],
};

export const renderCalendarPage = (workspaceId: Id<"workspaces">) =>
	render(
		<TooltipProvider>
			<ActiveWorkspaceProvider workspaceId={workspaceId}>
				<CalendarPage
					accountId="calendar-page-test-account"
					isDesktopMac={false}
					onOpenCalendarEventNote={vi.fn()}
					onOpenCalendarSettings={vi.fn()}
				/>
			</ActiveWorkspaceProvider>
		</TooltipProvider>,
	);

export const renderCalendarPageWithNewEventTrigger = (
	workspaceId: Id<"workspaces">,
) =>
	render(
		<TooltipProvider>
			<button
				type="button"
				onClick={() => window.dispatchEvent(new Event(OPEN_NEW_CALENDAR_EVENT))}
			>
				New event
			</button>
			<ActiveWorkspaceProvider workspaceId={workspaceId}>
				<CalendarPage
					accountId="calendar-page-test-account"
					isDesktopMac={false}
					onOpenCalendarEventNote={vi.fn()}
					onOpenCalendarSettings={vi.fn()}
				/>
			</ActiveWorkspaceProvider>
		</TooltipProvider>,
	);

export const resetCalendarPageTestMocks = () => {
	window.sessionStorage.clear();
	listCalendarEvents.mockReset();
	listCalendarEvents.mockResolvedValue(readyCalendar);
	createCalendar.mockReset();
	createCalendar.mockResolvedValue({ id: "created-calendar" });
	createCalendarEvent.mockReset();
	createCalendarEvent.mockResolvedValue({ id: "created-event" });
	deleteCalendar.mockReset();
	deleteCalendar.mockResolvedValue(null);
	deleteCalendarEvent.mockReset();
	deleteCalendarEvent.mockResolvedValue(null);
	removeCalendarEvent.mockReset();
	removeCalendarEvent.mockResolvedValue(null);
	setDefaultCalendar.mockReset();
	setDefaultCalendar.mockResolvedValue(null);
	updateCalendar.mockReset();
	updateCalendar.mockResolvedValue(null);
	updateCalendarEvent.mockReset();
	updateCalendarEvent.mockResolvedValue(null);
};
