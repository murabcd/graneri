import { act, renderHook, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useUpcomingCalendar } from "../src/app/use-upcoming-calendar";
import { requestCalendarRefresh } from "../src/components/calendar/calendar-refresh-signal";

const { listUpcomingCalendarEvents } = vi.hoisted(() => ({
	listUpcomingCalendarEvents: vi.fn(),
}));

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

describe("useUpcomingCalendar", () => {
	beforeEach(() => {
		window.sessionStorage.clear();
		listUpcomingCalendarEvents.mockReset();
		listUpcomingCalendarEvents.mockResolvedValue({
			status: "ready",
			connectedCalendarCount: 1,
			events: [],
		});
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

		act(() => requestCalendarRefresh(workspaceId));

		await waitFor(() =>
			expect(listUpcomingCalendarEvents).toHaveBeenCalledTimes(2),
		);
	});
});
