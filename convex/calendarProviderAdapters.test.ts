import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import {
	createGoogleCalendarProviderAdapter,
	createYandexCalendarProviderAdapter,
} from "./calendarProviderAdapters";
import type { GoogleAuthContext } from "./googleAuth";

const {
	createGoogleCalendar,
	createGoogleCalendarEvent,
	createYandexCalendar,
	createYandexCalendarEvent,
	deleteGoogleCalendarEvent,
	deleteYandexCalendarEvent,
	fetchGoogleCalendarEvents,
	getGoogleAuthContext,
	listYandexUpcomingEvents,
	updateGoogleCalendarEvent,
	updateYandexCalendarEvent,
} = vi.hoisted(() => ({
	createGoogleCalendar: vi.fn(),
	createGoogleCalendarEvent: vi.fn(),
	createYandexCalendar: vi.fn(),
	createYandexCalendarEvent: vi.fn(),
	deleteGoogleCalendarEvent: vi.fn(),
	deleteYandexCalendarEvent: vi.fn(),
	fetchGoogleCalendarEvents: vi.fn(),
	getGoogleAuthContext: vi.fn(),
	listYandexUpcomingEvents: vi.fn(),
	updateGoogleCalendarEvent: vi.fn(),
	updateYandexCalendarEvent: vi.fn(),
}));

vi.mock("./googleAuth", () => ({
	getGoogleAuthContext,
}));

vi.mock("./googleCalendar", () => ({
	createGoogleCalendar,
	createGoogleCalendarEvent,
	deleteGoogleCalendarEvent,
	fetchGoogleCalendarEvents,
	updateGoogleCalendarEvent,
}));

vi.mock("./yandexCalendar", () => ({
	createYandexCalendar,
	createYandexCalendarEvent,
	deleteYandexCalendarEvent,
	listYandexUpcomingEvents,
	updateYandexCalendarEvent,
}));

const emptyResult = {
	calendars: [],
	connectedCalendarCount: 0,
	events: [],
};

const googleAuthContext = {
	auth: {},
	headers: new Headers(),
} as unknown as GoogleAuthContext;

const yandexConnection = {
	calendarHomePath: "/calendars/owner/",
	email: "owner@example.com",
	password: "app-password",
	serverAddress: "caldav.yandex.test",
};
const workspaceId = "workspace-id" as Id<"workspaces">;

const createActionContext = ({
	connection = yandexConnection,
}: {
	connection?: typeof yandexConnection | null;
} = {}) => {
	const getUserIdentity = vi.fn(async () => ({
		tokenIdentifier: "owner-token",
	}));
	const runQuery = vi.fn(async () => connection);
	const ctx = {
		auth: { getUserIdentity },
		runQuery,
	} as unknown as ActionCtx;

	return { ctx, getUserIdentity, runQuery };
};

beforeEach(() => {
	vi.clearAllMocks();
	getGoogleAuthContext.mockResolvedValue(googleAuthContext);
	fetchGoogleCalendarEvents.mockResolvedValue(emptyResult);
	listYandexUpcomingEvents.mockResolvedValue(emptyResult);
	createGoogleCalendar.mockResolvedValue({ id: "google-calendar" });
	createYandexCalendar.mockResolvedValue({ id: "yandex-calendar" });
});

describe("calendar provider adapters", () => {
	it("does not acquire Google credentials until the adapter is used", async () => {
		const { ctx, getUserIdentity, runQuery } = createActionContext();
		const adapter = createGoogleCalendarProviderAdapter({ ctx });

		expect(getGoogleAuthContext).not.toHaveBeenCalled();
		expect(getUserIdentity).not.toHaveBeenCalled();
		expect(runQuery).not.toHaveBeenCalled();

		await adapter.listEvents({
			eventLimit: 12,
			minimumEndAt: 1_700_000_000_000,
			timeMax: 1_700_086_400_000,
			timeMin: 1_700_000_000_000,
		});

		expect(getGoogleAuthContext).toHaveBeenCalledOnce();
		expect(getUserIdentity).not.toHaveBeenCalled();
		expect(runQuery).not.toHaveBeenCalled();
	});

	it("loads one Yandex connection and reuses it across operations", async () => {
		const { ctx, getUserIdentity, runQuery } = createActionContext();
		const adapter = createYandexCalendarProviderAdapter({
			ctx,
			workspaceId,
		});

		await adapter.listEvents({
			eventLimit: 12,
			minimumEndAt: 1_700_000_000_000,
			timeMax: 1_700_086_400_000,
			timeMin: 1_700_000_000_000,
		});
		await adapter.createCalendar({
			color: "#10b981",
			name: "Personal",
		});

		expect(getUserIdentity).toHaveBeenCalledOnce();
		expect(runQuery).toHaveBeenCalledOnce();
		expect(listYandexUpcomingEvents).toHaveBeenCalledWith({
			connection: yandexConnection,
			now: 1_700_000_000_000,
			timeMax: 1_700_086_400_000,
			timeMin: 1_700_000_000_000,
		});
		expect(createYandexCalendar).toHaveBeenCalledWith({
			color: "#10b981",
			connection: yandexConnection,
			name: "Personal",
		});
	});

	it("returns an empty Yandex read and preserves write-specific errors when disconnected", async () => {
		const { ctx } = createActionContext({ connection: null });
		const adapter = createYandexCalendarProviderAdapter({
			ctx,
			ownerTokenIdentifier: "owner-token",
			workspaceId,
		});

		await expect(
			adapter.listEvents({
				eventLimit: 12,
				minimumEndAt: 1_700_000_000_000,
				timeMax: 1_700_086_400_000,
				timeMin: 1_700_000_000_000,
			}),
		).resolves.toEqual(emptyResult);
		await expect(
			adapter.createEvent({
				calendarId: "calendar-id",
				guests: [],
				time: {
					kind: "timed",
					endAt: "2026-07-27T11:00:00.000Z",
					startAt: "2026-07-27T10:00:00.000Z",
				},
				title: "Planning",
			}),
		).rejects.toMatchObject({
			data: {
				code: "YANDEX_CALENDAR_NOT_CONNECTED",
				message: "Connect Yandex Calendar to create this event.",
			},
		});

		expect(listYandexUpcomingEvents).not.toHaveBeenCalled();
		expect(createYandexCalendarEvent).not.toHaveBeenCalled();
	});
});
