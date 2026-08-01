import assert from "node:assert/strict";
import test from "node:test";
import { createAutoStartNoteSearch } from "../../../packages/platform/src/note-capture-navigation.mjs";
import { createDesktopTrayCalendar } from "../src/desktop-tray-calendar.mjs";
import {
	createLoadingTrayCalendarState,
	createUnavailableTrayCalendarState,
	getDetectedMeetingCalendarEventFromEvents,
} from "../src/desktop-tray-calendar-detection.mjs";

const createMeetingEvent = (overrides = {}) => ({
	attendees: [
		{
			displayName: "Mark Johnson",
			email: "mark@example.com",
			isOrganizer: false,
			isSelf: false,
			responseStatus: "accepted",
		},
	],
	calendarId: "calendar-1",
	calendarName: "Work",
	description: "Review the product plan",
	endAt: "2026-06-08T10:30:00.000Z",
	htmlLink: undefined,
	id: "event-1",
	isAllDay: false,
	isMeeting: true,
	isRecurring: false,
	location: undefined,
	meetingUrl: "https://meet.google.com/abc-defg-hij",
	provider: "google",
	providerEventId: "provider-event-1",
	recurrenceId: undefined,
	startAt: "2026-06-08T10:00:00.000Z",
	title: "Product review",
	...overrides,
});

const createCalendarReminderHarness = ({ events, preferences }) => {
	const openedExternalUrls = [];
	const openedMainWindows = [];
	const shownScheduledMeetingReminders = [];
	const calendar = createDesktopTrayCalendar({
		calendarSource: {
			listCurrentDayEvents: async () => ({
				connectedCalendarCount: 1,
				events,
				status: "ready",
			}),
		},
		getNotificationPreferences: () => preferences,
		onOpenMainWindow: async (options) => {
			openedMainWindows.push(options);
		},
		onShowScheduledMeetingReminder: async (event) => {
			shownScheduledMeetingReminders.push(event);
		},
		onStateChange: () => {},
		shellApi: {
			openExternal: async (url) => {
				openedExternalUrls.push(url);
			},
		},
		shouldMaintainCalendar: () => true,
	});

	return {
		calendar,
		openedExternalUrls,
		openedMainWindows,
		shownScheduledMeetingReminders,
	};
};

test("creates one-shot auto-start navigation for detected meeting widgets", () => {
	const searchParams = new URLSearchParams(
		createAutoStartNoteSearch({
			stopCaptureWhenMeetingEnds: true,
		}).slice(1),
	);

	assert.equal(searchParams.get("capture"), "1");
	assert.match(searchParams.get("captureRequestId"), /^[0-9a-f-]{36}$/);
	assert.equal(searchParams.get("meeting"), "1");
});

test("opens live tray meetings with a one-shot capture request", async () => {
	const event = createMeetingEvent({
		endAt: new Date(Date.now() + 30 * 60_000).toISOString(),
		startAt: new Date(Date.now() - 5 * 60_000).toISOString(),
	});
	const harness = createCalendarReminderHarness({
		events: [event],
		preferences: {
			notifyForAutoDetectedMeetings: false,
			notifyForScheduledMeetings: false,
		},
	});

	await harness.calendar.openCalendarEventNote(event);

	assert.equal(harness.openedMainWindows.length, 1);
	const searchParams = new URLSearchParams(
		harness.openedMainWindows[0].search.slice(1),
	);
	assert.equal(searchParams.get("capture"), "1");
	assert.match(searchParams.get("captureRequestId"), /^[0-9a-f-]{36}$/);
	assert.equal(searchParams.get("meeting"), "1");
	assert.match(
		searchParams.get("calendarEventRequestId"),
		/^[0-9a-f-]{36}$/u,
	);
	const requestId = searchParams.get("calendarEventRequestId");
	assert.deepEqual(harness.calendar.consumeCalendarEventRequest(requestId), event);
	assert.equal(harness.calendar.consumeCalendarEventRequest(requestId), null);
	assert.deepEqual(harness.openedExternalUrls, [event.meetingUrl]);
});

test("does not expose mutable nested tray calendar state", async () => {
	const event = createMeetingEvent();
	const harness = createCalendarReminderHarness({
		events: [event],
		preferences: {
			notifyForAutoDetectedMeetings: false,
			notifyForScheduledMeetings: false,
		},
	});

	await harness.calendar.refresh();
	harness.calendar.clearRefresh();
	const firstState = harness.calendar.getState();
	firstState.events[0].attendees[0].email = "mutated@example.com";

	assert.equal(
		harness.calendar.getState().events[0].attendees[0].email,
		"mark@example.com",
	);
});

test("rejects invalid tray events before navigation", async () => {
	const harness = createCalendarReminderHarness({
		events: [],
		preferences: {
			notifyForAutoDetectedMeetings: false,
			notifyForScheduledMeetings: false,
		},
	});

	await assert.rejects(
		harness.calendar.openCalendarEventNote(
			createMeetingEvent({ attendees: undefined }),
		),
		/invalid or too large/u,
	);
	assert.deepEqual(harness.openedMainWindows, []);
});

test("detects live calendar meetings", () => {
	const event = createMeetingEvent();

	assert.equal(
		getDetectedMeetingCalendarEventFromEvents(
			[event],
			new Date("2026-06-08T10:05:00.000Z"),
		),
		event,
	);
});

test("shows a scheduled meeting reminder when enabled and the meeting is due", async () => {
	const startAt = new Date(Date.now() + 10_000).toISOString();
	const event = createMeetingEvent({
		endAt: new Date(Date.now() + 30 * 60_000).toISOString(),
		startAt,
	});
	const harness = createCalendarReminderHarness({
		events: [event],
		preferences: {
			notifyForAutoDetectedMeetings: false,
			notifyForScheduledMeetings: true,
		},
	});

	await harness.calendar.refresh();
	harness.calendar.clearRefresh();

	assert.deepEqual(harness.shownScheduledMeetingReminders, [event]);
});

test("does not repeat a scheduled reminder for the same due event", async () => {
	const event = createMeetingEvent({
		endAt: new Date(Date.now() + 30 * 60_000).toISOString(),
		startAt: new Date(Date.now() + 10_000).toISOString(),
	});
	const harness = createCalendarReminderHarness({
		events: [event],
		preferences: {
			notifyForAutoDetectedMeetings: false,
			notifyForScheduledMeetings: true,
		},
	});

	await harness.calendar.refresh();
	await harness.calendar.refresh();
	harness.calendar.clearRefresh();

	assert.deepEqual(harness.shownScheduledMeetingReminders, [event]);
});

test("does not burn a scheduled reminder while preferences are still disabled", async () => {
	const preferences = {
		notifyForAutoDetectedMeetings: false,
		notifyForScheduledMeetings: false,
	};
	const event = createMeetingEvent({
		endAt: new Date(Date.now() + 30 * 60_000).toISOString(),
		startAt: new Date(Date.now() + 10_000).toISOString(),
	});
	const harness = createCalendarReminderHarness({
		events: [event],
		preferences,
	});

	await harness.calendar.refresh();
	preferences.notifyForScheduledMeetings = true;
	await harness.calendar.refresh();
	harness.calendar.clearRefresh();

	assert.deepEqual(harness.shownScheduledMeetingReminders, [event]);
});

test("associates ad-hoc calls with meetings started within the last 15 minutes", () => {
	const event = createMeetingEvent({
		endAt: "2026-06-08T10:05:00.000Z",
	});

	assert.equal(
		getDetectedMeetingCalendarEventFromEvents(
			[event],
			new Date("2026-06-08T10:14:59.000Z"),
		),
		event,
	);
	assert.equal(
		getDetectedMeetingCalendarEventFromEvents(
			[event],
			new Date("2026-06-08T10:15:01.000Z"),
		),
		null,
	);
});

test("does not use future calendar meetings as detected meeting context", () => {
	const event = createMeetingEvent();

	assert.equal(
		getDetectedMeetingCalendarEventFromEvents(
			[event],
			new Date("2026-06-08T09:59:01.000Z"),
		),
		null,
	);
	assert.equal(
		getDetectedMeetingCalendarEventFromEvents(
			[event],
			new Date("2026-06-08T09:55:00.000Z"),
		),
		null,
	);
});

test("keeps the last ready tray events during loading and transient failure states", () => {
	const event = createMeetingEvent();
	const readyState = {
		connectedCalendarCount: 1,
		events: [event],
		status: "ready",
	};

	assert.equal(
		createLoadingTrayCalendarState({ previousState: readyState }),
		readyState,
	);
	assert.equal(
		createUnavailableTrayCalendarState({
			previousState: readyState,
			status: "error",
		}),
		readyState,
	);
	assert.deepEqual(
		createLoadingTrayCalendarState({ previousState: { status: "idle" } }),
		{
			connectedCalendarCount: 0,
			events: [],
			status: "loading",
		},
	);
	assert.deepEqual(
		createUnavailableTrayCalendarState({
			previousState: { status: "loading" },
			status: "error",
		}),
		{
			connectedCalendarCount: 0,
			events: [],
			status: "error",
		},
	);
});
