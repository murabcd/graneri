import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpcomingCalendarState } from "../src/app/app-types";
import { HomeView } from "../src/app/home-shared-views";

const renderHome = (upcomingCalendar: UpcomingCalendarState) =>
	render(
		<HomeView
			currentDate={new Date("2026-07-26T12:00:00.000Z")}
			currentDayOfMonth={26}
			currentMonthLabel="July"
			currentWeekdayLabel="Sun"
			currentNoteId={null}
			currentNoteTitle=""
			currentUser={{
				avatar: "",
				email: "person@example.com",
				name: "Person",
			}}
			isDesktopMac={false}
			notes={[]}
			upcomingCalendar={upcomingCalendar}
			onCreateNote={vi.fn()}
			onNoteTrashed={vi.fn()}
			onOpenCalendarEventNote={vi.fn()}
			onOpenCalendarSettings={vi.fn()}
			onOpenNote={vi.fn()}
		/>,
	);

afterEach(cleanup);

describe("HomeView", () => {
	it("owns its desktop text-selection policy at the page boundary", () => {
		const { container } = renderHome({ status: "ready", events: [] });

		expect(
			container.firstElementChild?.hasAttribute("data-desktop-nonselectable"),
		).toBe(true);
	});

	it("renders meeting-row skeletons while the calendar initially loads", () => {
		renderHome({ status: "checking", events: [] });

		const calendarSkeleton = screen.getByRole("status", {
			name: "Loading upcoming meetings",
		});

		expect(
			calendarSkeleton.querySelectorAll('[data-slot="skeleton"]'),
		).toHaveLength(12);
		expect(screen.queryByText("Calendar settings")).toBeNull();
	});

	it("keeps cached meetings visible during a background refresh", () => {
		renderHome({
			status: "refreshing",
			events: [
				{
					attendees: [],
					canDelete: true,
					canEdit: true,
					guestPermissions: "manage",
					id: "event-1",
					calendarId: "work",
					calendarName: "Work",
					title: "Example meeting",
					startAt: "2026-07-26T12:30:00.000Z",
					endAt: "2026-07-26T13:00:00.000Z",
					isAllDay: false,
					isMeeting: true,
					isRecurring: false,
					provider: "google",
					providerEventId: "provider-event-1",
				},
			],
		});

		expect(screen.getByText("Example meeting")).not.toBeNull();
		expect(screen.queryByText("Updating…")).toBeNull();
		expect(
			screen.getByRole("status", { name: "Calendar status: Updating" }),
		).not.toBeNull();
		expect(
			screen.queryByRole("status", {
				name: "Loading upcoming meetings",
			}),
		).toBeNull();
	});
});
