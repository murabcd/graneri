import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getDesktopCalendarEventRequest,
	releaseDesktopCalendarEventRequest,
} from "../src/app/desktop-calendar-event-request";

const requestId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const event = {
	attendees: [],
	canDelete: true,
	canEdit: true,
	guestPermissions: "manage",
	calendarId: "calendar-1",
	calendarName: "Work",
	endAt: "2026-08-10T11:00:00.000Z",
	id: "event-1",
	isAllDay: false,
	isMeeting: true,
	isRecurring: false,
	provider: "google" as const,
	providerEventId: "provider-event-1",
	startAt: "2026-08-10T10:00:00.000Z",
	title: "Customer review",
};

afterEach(() => {
	releaseDesktopCalendarEventRequest(requestId);
	window.graneriDesktop = undefined;
});

describe("desktop calendar event request", () => {
	it("deduplicates Strict Mode consumption and releases completed requests", async () => {
		const consumeTrayCalendarEvent = vi
			.fn()
			.mockResolvedValueOnce({ event })
			.mockResolvedValueOnce({ event: null });
		window.graneriDesktop = {
			consumeTrayCalendarEvent,
			platform: "darwin",
		} as Window["graneriDesktop"];

		await expect(
			Promise.all([
				getDesktopCalendarEventRequest(requestId),
				getDesktopCalendarEventRequest(requestId),
			]),
		).resolves.toEqual([event, event]);
		expect(consumeTrayCalendarEvent).toHaveBeenCalledTimes(1);

		releaseDesktopCalendarEventRequest(requestId);
		await expect(getDesktopCalendarEventRequest(requestId)).resolves.toBe(null);
		expect(consumeTrayCalendarEvent).toHaveBeenCalledTimes(2);
	});
});
