import { act, renderHook, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useUpcomingCalendar } from "../src/app/use-upcoming-calendar";
import { invalidateCalendarSnapshots } from "../src/components/calendar/calendar-snapshot-module";

const { listUpcomingCalendarEvents, syncReadyDesktopTrayCalendar } = vi.hoisted(
	() => ({
		listUpcomingCalendarEvents: vi.fn(),
		syncReadyDesktopTrayCalendar: vi.fn(),
	}),
);

vi.mock("convex/react", () => ({
	useAction: () => listUpcomingCalendarEvents,
	useQuery: (reference: never) => {
		const functionName = getFunctionName(reference);

		if (functionName === "calendarPreferences:get") {
			return {
				showGoogleCalendar: true,
				showGoogleDrive: false,
				showYandexCalendar: false,
			};
		}

		return null;
	},
}));

vi.mock("../src/app/desktop-tray-calendar-sync", () => ({
	syncDisconnectedDesktopTrayCalendar: vi.fn(),
	syncErrorDesktopTrayCalendar: vi.fn(),
	syncReadyDesktopTrayCalendar,
}));

const calendarEvent = {
	attendees: [],
	canDelete: true,
	canEdit: true,
	calendarId: "work",
	calendarName: "Work",
	endAt: "2026-07-26T11:00:00.000Z",
	id: "event-1",
	isAllDay: false,
	isMeeting: true,
	isRecurring: false,
	provider: "google" as const,
	providerEventId: "provider-event-1",
	startAt: "2026-07-26T10:00:00.000Z",
	title: "Planning",
};

describe("useUpcomingCalendar", () => {
	beforeEach(() => {
		window.sessionStorage.clear();
		listUpcomingCalendarEvents.mockReset();
		listUpcomingCalendarEvents.mockResolvedValue({
			status: "ready",
			connectedCalendarCount: 1,
			events: [],
		});
		syncReadyDesktopTrayCalendar.mockReset();
	});

	it("refreshes after a calendar mutation in the active workspace", async () => {
		const workspaceId =
			"upcoming-calendar-refresh-workspace" as Id<"workspaces">;

		renderHook(() =>
			useUpcomingCalendar({
				accountId: "account-id",
				currentDayKey: "2026-7-26",
				isAuthenticated: true,
				workspaceId,
			}),
		);

		await waitFor(() =>
			expect(listUpcomingCalendarEvents).toHaveBeenCalledTimes(1),
		);

		act(() => invalidateCalendarSnapshots(workspaceId));

		await waitFor(() =>
			expect(listUpcomingCalendarEvents).toHaveBeenCalledTimes(2),
		);
	});

	it("retains the last complete Home and tray snapshot on refresh failure", async () => {
		const workspaceId =
			"upcoming-calendar-failure-workspace" as Id<"workspaces">;
		listUpcomingCalendarEvents.mockResolvedValueOnce({
			status: "ready",
			connectedCalendarCount: 1,
			events: [calendarEvent],
		});
		const { result } = renderHook(() =>
			useUpcomingCalendar({
				accountId: "account-id",
				currentDayKey: "2026-7-26",
				isAuthenticated: true,
				workspaceId,
			}),
		);
		await waitFor(() =>
			expect(result.current).toEqual({
				status: "ready",
				events: [calendarEvent],
			}),
		);
		listUpcomingCalendarEvents.mockRejectedValueOnce(
			new Error("Provider unavailable"),
		);

		act(() => invalidateCalendarSnapshots(workspaceId));

		await waitFor(() =>
			expect(result.current).toEqual({
				status: "error",
				events: [calendarEvent],
			}),
		);
		expect(syncReadyDesktopTrayCalendar).toHaveBeenLastCalledWith({
			connectedCalendarCount: 1,
			events: [calendarEvent],
		});
	});

	it("does not project a retained snapshot into another day", async () => {
		const workspaceId =
			"upcoming-calendar-day-scope-workspace" as Id<"workspaces">;
		listUpcomingCalendarEvents.mockResolvedValueOnce({
			status: "ready",
			connectedCalendarCount: 1,
			events: [calendarEvent],
		});
		const { rerender, result } = renderHook(
			({ currentDayKey }) =>
				useUpcomingCalendar({
					accountId: "account-id",
					currentDayKey,
					isAuthenticated: true,
					workspaceId,
				}),
			{ initialProps: { currentDayKey: "2026-7-26" } },
		);
		await waitFor(() =>
			expect(result.current).toEqual({
				status: "ready",
				events: [calendarEvent],
			}),
		);
		listUpcomingCalendarEvents.mockImplementationOnce(
			() => new Promise<never>(() => undefined),
		);

		rerender({ currentDayKey: "2026-7-27" });

		await waitFor(() =>
			expect(result.current).toEqual({ status: "checking", events: [] }),
		);
	});
});
