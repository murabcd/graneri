import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopSyncedCalendar } from "../src/desktop-synced-calendar.mjs";

const createCalendarEvent = (overrides = {}) => ({
	attendees: [
		{
			displayName: "Mark Johnson",
			email: "MARK@example.com",
			isOrganizer: false,
			isSelf: false,
			responseStatus: "accepted",
		},
	],
	canDelete: true,
	canEdit: true,
	calendarId: "calendar-1",
	calendarName: "Work",
	description: undefined,
	endAt: "2026-06-16T17:00:00Z",
	htmlLink: "https://calendar.example/event",
	id: "event-1",
	isAllDay: false,
	isMeeting: true,
	isRecurring: false,
	location: undefined,
	meetingUrl: "https://meet.google.com/abc-defg-hij",
	provider: "google",
	providerEventId: "provider-event-1",
	recurrenceId: undefined,
	startAt: "2026-06-16T16:00:00Z",
	title: "Planning",
	...overrides,
});

test("stores normalized renderer-synced tray calendar events", async () => {
	const calendar = createDesktopSyncedCalendar();

	calendar.setState({
		connectedCalendarCount: 1,
		events: [createCalendarEvent()],
		status: "ready",
	});

	assert.deepEqual(await calendar.listCurrentDayEvents(), {
		connectedCalendarCount: 1,
		events: [
			{
				attendees: [
					{
						displayName: "Mark Johnson",
						email: "mark@example.com",
						isOrganizer: false,
						isSelf: false,
						responseStatus: "accepted",
					},
				],
				canDelete: true,
				canEdit: true,
				calendarId: "calendar-1",
				calendarName: "Work",
				description: undefined,
				endAt: "2026-06-16T17:00:00.000Z",
				htmlLink: "https://calendar.example/event",
				id: "event-1",
				isAllDay: false,
				isMeeting: true,
				isRecurring: false,
				location: undefined,
				meetingUrl: "https://meet.google.com/abc-defg-hij",
				provider: "google",
				providerEventId: "provider-event-1",
				recurrenceId: undefined,
				startAt: "2026-06-16T16:00:00.000Z",
				title: "Planning",
			},
		],
		status: "ready",
	});
});

test("rejects invalid tray calendar status", () => {
	const calendar = createDesktopSyncedCalendar();

	assert.throws(
		() => calendar.setState({ events: [], status: "checking" }),
		/Tray calendar status is invalid/,
	);
});

test("clears synced tray calendar events when disconnected", async () => {
	const calendar = createDesktopSyncedCalendar();

	calendar.setState({
		connectedCalendarCount: 1,
		events: [
			createCalendarEvent({
				htmlLink: undefined,
				isMeeting: false,
				meetingUrl: undefined,
			}),
		],
		status: "ready",
	});
	calendar.setState({ events: [], status: "not_connected" });

	assert.deepEqual(await calendar.listCurrentDayEvents(), {
		connectedCalendarCount: 0,
		events: [],
		status: "not_connected",
	});
});

test("does not expose mutable synced calendar state", async () => {
	const calendar = createDesktopSyncedCalendar();

	calendar.setState({
		connectedCalendarCount: 1,
		events: [createCalendarEvent({ htmlLink: undefined })],
		status: "ready",
	});

	const firstRead = await calendar.listCurrentDayEvents();
	firstRead.events[0].title = "Mutated";
	firstRead.events.push({ ...firstRead.events[0], id: "event-2" });

	const secondRead = await calendar.listCurrentDayEvents();
	assert.equal(secondRead.events.length, 1);
	assert.equal(secondRead.events[0].title, "Planning");
});
