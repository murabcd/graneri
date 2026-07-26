import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { UpcomingCalendarEvent } from "../src/app/app-types";
import {
	type CalendarAgendaScope,
	type CalendarAgendaSnapshot,
	createCalendarSourceKey,
	invalidateCalendarSnapshots,
	loadCalendarAgendaSnapshot,
	loadUpcomingCalendarSnapshot,
	observeCalendarSnapshotSource,
	readCalendarAgendaSnapshot,
	readCalendarSnapshotGeneration,
	readRecentUpcomingCalendarSnapshot,
	readUpcomingCalendarSnapshot,
	type UpcomingCalendarScope,
} from "../src/components/calendar/calendar-snapshot-module";
import type { CalendarSource } from "../src/components/calendar/calendar-view-model";

const calendar: CalendarSource = {
	canCreateEvents: true,
	color: "#3b82f6",
	id: "work",
	name: "Work",
	provider: "google",
};

const createEvent = (id: string): UpcomingCalendarEvent => ({
	calendarId: calendar.id,
	calendarName: calendar.name,
	endAt: "2026-07-27T11:00:00.000Z",
	id,
	isAllDay: false,
	isMeeting: true,
	isRecurring: false,
	provider: "google",
	providerEventId: `provider-${id}`,
	startAt: "2026-07-27T10:00:00.000Z",
	title: `Event ${id}`,
});

const sourceKey = createCalendarSourceKey({
	showGoogleCalendar: true,
	showYandexCalendar: false,
	yandexConnectionSourceId: null,
	yandexConnectionStatus: null,
});

const createAgendaScope = (
	workspaceId: Id<"workspaces">,
	overrides: Partial<CalendarAgendaScope> = {},
): CalendarAgendaScope => ({
	accountId: "account-1",
	requestWindow: {
		timeMax: "2026-08-24T00:00:00.000Z",
		timeMin: "2026-07-25T00:00:00.000Z",
	},
	sourceKey,
	workspaceId,
	...overrides,
});

const createUpcomingScope = (
	workspaceId: Id<"workspaces">,
	overrides: Partial<UpcomingCalendarScope> = {},
): UpcomingCalendarScope => ({
	accountId: "account-1",
	dayKey: "2026-7-26",
	sourceKey,
	workspaceId,
	...overrides,
});

const readyAgenda = (event: UpcomingCalendarEvent) =>
	Promise.resolve({
		calendars: [calendar],
		events: [event],
		status: "ready" as const,
	});

const readyUpcoming = (event: UpcomingCalendarEvent) =>
	Promise.resolve({
		connectedCalendarCount: 1,
		events: [event],
		status: "ready" as const,
	});

describe("calendar snapshot module", () => {
	beforeEach(() => {
		window.sessionStorage.clear();
	});

	it("owns distinct Agenda and Home snapshots under one scoped store", async () => {
		const workspaceId = "snapshot-module-scopes" as Id<"workspaces">;
		const agendaScope = createAgendaScope(workspaceId);
		const upcomingScope = createUpcomingScope(workspaceId);
		const agendaEvent = createEvent("agenda");
		const upcomingEvent = createEvent("upcoming");

		await loadCalendarAgendaSnapshot({
			generation: readCalendarSnapshotGeneration(workspaceId),
			load: () => readyAgenda(agendaEvent),
			scope: agendaScope,
		});
		await loadUpcomingCalendarSnapshot({
			generation: readCalendarSnapshotGeneration(workspaceId),
			load: () => readyUpcoming(upcomingEvent),
			scope: upcomingScope,
		});

		expect(readCalendarAgendaSnapshot(agendaScope)).toEqual({
			calendars: [calendar],
			events: [agendaEvent],
		});
		expect(readUpcomingCalendarSnapshot(upcomingScope)).toEqual({
			connectedCalendarCount: 1,
			events: [upcomingEvent],
		});
		expect(
			readCalendarAgendaSnapshot(
				createAgendaScope(workspaceId, {
					requestWindow: {
						timeMax: "2026-09-23T00:00:00.000Z",
						timeMin: "2026-08-24T00:00:00.000Z",
					},
				}),
			),
		).toBeNull();
		expect(
			readUpcomingCalendarSnapshot(
				createUpcomingScope(workspaceId, { accountId: "account-2" }),
			),
		).toBeNull();
	});

	it("invalidates every persisted projection for a workspace", async () => {
		const workspaceId = "snapshot-module-invalidation" as Id<"workspaces">;
		const agendaScope = createAgendaScope(workspaceId);
		const upcomingScope = createUpcomingScope(workspaceId);

		await loadCalendarAgendaSnapshot({
			generation: readCalendarSnapshotGeneration(workspaceId),
			load: () => readyAgenda(createEvent("agenda-before-invalidation")),
			scope: agendaScope,
		});
		await loadUpcomingCalendarSnapshot({
			generation: readCalendarSnapshotGeneration(workspaceId),
			load: () => readyUpcoming(createEvent("home-before-invalidation")),
			scope: upcomingScope,
		});

		invalidateCalendarSnapshots(workspaceId);

		expect(readCalendarAgendaSnapshot(agendaScope)).toBeNull();
		expect(readUpcomingCalendarSnapshot(upcomingScope)).toBeNull();
		expect(
			readRecentUpcomingCalendarSnapshot({
				accountId: upcomingScope.accountId,
				dayKey: upcomingScope.dayKey,
				workspaceId,
			}),
		).toBeNull();
	});

	it("discards an older generation instead of overwriting fresh data", async () => {
		const workspaceId = "snapshot-module-generation-fence" as Id<"workspaces">;
		const scope = createAgendaScope(workspaceId);
		const staleEvent = createEvent("stale");
		const freshEvent = createEvent("fresh");
		let resolveStale:
			| ((value: {
					calendars: CalendarSource[];
					events: UpcomingCalendarEvent[];
					status: "ready";
			  }) => void)
			| null = null;
		const staleResponse = new Promise<{
			calendars: CalendarSource[];
			events: UpcomingCalendarEvent[];
			status: "ready";
		}>((resolve) => {
			resolveStale = resolve;
		});
		const staleRequest = loadCalendarAgendaSnapshot({
			generation: readCalendarSnapshotGeneration(workspaceId),
			load: () => staleResponse,
			scope,
		});

		invalidateCalendarSnapshots(workspaceId);
		const freshResult = await loadCalendarAgendaSnapshot({
			generation: readCalendarSnapshotGeneration(workspaceId),
			load: () => readyAgenda(freshEvent),
			scope,
		});
		resolveStale?.({
			calendars: [calendar],
			events: [staleEvent],
			status: "ready",
		});

		expect(freshResult).toEqual({
			snapshot: {
				calendars: [calendar],
				events: [freshEvent],
			},
			status: "ready",
		});
		await expect(staleRequest).resolves.toEqual({ status: "obsolete" });
		expect(readCalendarAgendaSnapshot(scope)).toEqual({
			calendars: [calendar],
			events: [freshEvent],
		});
	});

	it("does not start provider work for an already obsolete generation", async () => {
		const workspaceId = "snapshot-module-obsolete-render" as Id<"workspaces">;
		const scope = createAgendaScope(workspaceId);
		const obsoleteGeneration = readCalendarSnapshotGeneration(workspaceId);
		const load = vi.fn(() => readyAgenda(createEvent("obsolete")));
		invalidateCalendarSnapshots(workspaceId);

		await expect(
			loadCalendarAgendaSnapshot({
				generation: obsoleteGeneration,
				load,
				scope,
			}),
		).resolves.toEqual({ status: "obsolete" });
		expect(load).not.toHaveBeenCalled();
	});

	it("observes a provider-source change once across multiple consumers", async () => {
		const workspaceId = "snapshot-module-source-change" as Id<"workspaces">;
		const scope = createUpcomingScope(workspaceId);
		await loadUpcomingCalendarSnapshot({
			generation: readCalendarSnapshotGeneration(workspaceId),
			load: () => readyUpcoming(createEvent("source-change")),
			scope,
		});
		observeCalendarSnapshotSource(workspaceId, sourceKey);
		const nextSourceKey = createCalendarSourceKey({
			showGoogleCalendar: true,
			showYandexCalendar: true,
			yandexConnectionSourceId: "source-1",
			yandexConnectionStatus: "connected",
		});

		observeCalendarSnapshotSource(workspaceId, nextSourceKey);
		observeCalendarSnapshotSource(workspaceId, nextSourceKey);

		expect(readUpcomingCalendarSnapshot(scope)).toBeNull();
		expect(readCalendarSnapshotGeneration(workspaceId)).toBe(1);
	});

	it("coalesces duplicate loads within the same generation", async () => {
		const workspaceId = "snapshot-module-coalescing" as Id<"workspaces">;
		const scope = createAgendaScope(workspaceId);
		let resolveLoad: ((value: CalendarAgendaSnapshot) => void) | null = null;
		const response = new Promise<CalendarAgendaSnapshot>((resolve) => {
			resolveLoad = resolve;
		});
		const load = () =>
			response.then((snapshot) => ({ ...snapshot, status: "ready" as const }));

		const generation = readCalendarSnapshotGeneration(workspaceId);
		const firstRequest = loadCalendarAgendaSnapshot({
			generation,
			load,
			scope,
		});
		const duplicateRequest = loadCalendarAgendaSnapshot({
			generation,
			load,
			scope,
		});

		expect(duplicateRequest).toBe(firstRequest);
		resolveLoad?.({
			calendars: [calendar],
			events: [createEvent("coalesced")],
		});
		await expect(firstRequest).resolves.toMatchObject({ status: "ready" });
	});
});
