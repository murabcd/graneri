import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopTrayCalendar } from "../src/desktop-tray-calendar.mjs";
import {
	createLoadingTrayCalendarState,
	createUnavailableTrayCalendarState,
	getDetectedMeetingCalendarEventFromEvents,
} from "../src/desktop-tray-calendar-detection.mjs";

const createMeetingEvent = (overrides = {}) => ({
	calendarId: "calendar-1",
	calendarName: "Work",
	endAt: "2026-06-08T10:30:00.000Z",
	htmlLink: null,
	id: "event-1",
	isAllDay: false,
	isMeeting: true,
	location: null,
	meetingUrl: "https://meet.google.com/abc-defg-hij",
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
