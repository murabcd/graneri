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
	removeGoogleCalendar,
	removeGoogleCalendarEvent,
	removeYandexCalendar,
	removeYandexCalendarEvent,
	setDefaultYandexCalendar,
	updateGoogleCalendar,
	updateGoogleCalendarEvent,
	updateYandexCalendar,
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
	removeGoogleCalendar: vi.fn(),
	removeGoogleCalendarEvent: vi.fn(),
	removeYandexCalendar: vi.fn(),
	removeYandexCalendarEvent: vi.fn(),
	setDefaultYandexCalendar: vi.fn(),
	updateGoogleCalendar: vi.fn(),
	updateGoogleCalendarEvent: vi.fn(),
	updateYandexCalendar: vi.fn(),
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
	removeGoogleCalendar,
	removeGoogleCalendarEvent,
	updateGoogleCalendar,
	updateGoogleCalendarEvent,
}));

vi.mock("./yandexCalendar", () => ({
	createYandexCalendar,
	listYandexUpcomingEvents,
	removeYandexCalendar,
	setDefaultYandexCalendar,
	updateYandexCalendar,
}));

vi.mock("./yandexCalendarEvents", () => ({
	createYandexCalendarEvent,
	deleteYandexCalendarEvent,
	removeYandexCalendarEvent,
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
	setDefaultYandexCalendar.mockResolvedValue(null);
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

	it("uses a trusted Google context supplied by a durable run", async () => {
		const { ctx } = createActionContext();
		const adapter = createGoogleCalendarProviderAdapter({
			ctx,
			googleAuthContext,
		});

		await adapter.listEvents({
			eventLimit: 12,
			minimumEndAt: 1_700_000_000_000,
			timeMax: 1_700_086_400_000,
			timeMin: 1_700_000_000_000,
		});

		expect(getGoogleAuthContext).not.toHaveBeenCalled();
		expect(fetchGoogleCalendarEvents).toHaveBeenCalledWith(
			expect.objectContaining({ authContext: googleAuthContext }),
		);
	});

	it("loads one Yandex connection and reuses it across operations", async () => {
		const { ctx, getUserIdentity, runQuery } = createActionContext();
		const adapter = createYandexCalendarProviderAdapter({
			ctx,
			source: { workspaceId },
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
		await adapter.setDefaultCalendar({ calendarId: "yandex-calendar" });

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
		expect(setDefaultYandexCalendar).toHaveBeenCalledWith({
			calendarId: "yandex-calendar",
			connection: yandexConnection,
		});
	});

	it("returns an empty Yandex read and preserves write-specific errors when disconnected", async () => {
		const { ctx } = createActionContext({ connection: null });
		const adapter = createYandexCalendarProviderAdapter({
			ctx,
			source: { ownerTokenIdentifier: "owner-token", workspaceId },
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
