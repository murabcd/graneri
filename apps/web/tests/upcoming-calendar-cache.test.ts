import { beforeEach, describe, expect, it } from "vitest";
import type { UpcomingCalendarEvent } from "../src/app/app-types";
import {
	createUpcomingCalendarScopeKey,
	readRecentUpcomingCalendarSnapshot,
	readUpcomingCalendarSnapshot,
	writeUpcomingCalendarSnapshot,
} from "../src/app/upcoming-calendar-cache";

const event: UpcomingCalendarEvent = {
	id: "event-1",
	calendarId: "work",
	calendarName: "Work",
	title: "Planning",
	startAt: "2026-07-26T10:00:00.000Z",
	endAt: "2026-07-26T11:00:00.000Z",
	isAllDay: false,
	isMeeting: true,
	isRecurring: false,
	provider: "google",
	providerEventId: "provider-event-1",
};

const createScopeKey = ({
	accountId = "account-1",
	dayKey = "2026-7-26",
	workspaceId = "workspace-1",
}: {
	accountId?: string;
	dayKey?: string;
	workspaceId?: string;
} = {}) =>
	createUpcomingCalendarScopeKey({
		accountId,
		dayKey,
		showGoogleCalendar: true,
		showYandexCalendar: false,
		workspaceId,
		yandexConnectionSourceId: null,
		yandexConnectionStatus: null,
	});

describe("upcoming calendar cache", () => {
	beforeEach(() => {
		window.sessionStorage.clear();
	});

	it("ignores malformed stored calendar data", () => {
		window.sessionStorage.setItem(
			"graneri:upcoming-calendar-cache:v1",
			JSON.stringify({
				version: 1,
				calendars: [
					{
						cachedAt: Date.now(),
						connectedCalendarCount: 1,
						events: [{ title: "Incomplete event" }],
						key: "invalid",
					},
				],
			}),
		);

		expect(readUpcomingCalendarSnapshot("invalid")).toBeNull();
	});

	it("restores a verified workspace and day snapshot", () => {
		const scopeKey = createScopeKey();
		const snapshot = {
			connectedCalendarCount: 1,
			events: [event],
		};

		writeUpcomingCalendarSnapshot(scopeKey, snapshot);

		expect(readUpcomingCalendarSnapshot(scopeKey)).toEqual(snapshot);
		expect(
			window.sessionStorage.getItem("graneri:upcoming-calendar-cache:v1"),
		).toContain('"version":1');
	});

	it("does not reuse snapshots across accounts, workspaces, or days", () => {
		const scopeKey = createScopeKey();
		writeUpcomingCalendarSnapshot(scopeKey, {
			connectedCalendarCount: 1,
			events: [event],
		});

		expect(
			readUpcomingCalendarSnapshot(createScopeKey({ accountId: "account-2" })),
		).toBeNull();
		expect(
			readUpcomingCalendarSnapshot(
				createScopeKey({ workspaceId: "workspace-2" }),
			),
		).toBeNull();
		expect(
			readUpcomingCalendarSnapshot(createScopeKey({ dayKey: "2026-7-27" })),
		).toBeNull();
	});

	it("restores the latest verified provider scope while settings resolve", () => {
		const olderScopeKey = createScopeKey();
		writeUpcomingCalendarSnapshot(olderScopeKey, {
			connectedCalendarCount: 1,
			events: [event],
		});
		const newerScopeKey = createUpcomingCalendarScopeKey({
			accountId: "account-1",
			dayKey: "2026-7-26",
			showGoogleCalendar: true,
			showYandexCalendar: true,
			workspaceId: "workspace-1",
			yandexConnectionSourceId: "source-1",
			yandexConnectionStatus: "connected",
		});
		const newerSnapshot = {
			connectedCalendarCount: 2,
			events: [
				{ ...event, id: "event-2", providerEventId: "provider-event-2" },
			],
		};
		writeUpcomingCalendarSnapshot(newerScopeKey, newerSnapshot);

		expect(
			readRecentUpcomingCalendarSnapshot({
				accountId: "account-1",
				dayKey: "2026-7-26",
				workspaceId: "workspace-1",
			}),
		).toEqual(newerSnapshot);
		expect(
			readRecentUpcomingCalendarSnapshot({
				accountId: "account-2",
				dayKey: "2026-7-26",
				workspaceId: "workspace-1",
			}),
		).toBeNull();
	});
});
