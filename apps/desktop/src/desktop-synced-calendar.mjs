import { z } from "zod";
import { normalizeCalendarEventPayload } from "../../../packages/platform/src/calendar-event-navigation.mjs";

const createUnavailableCalendarResult = (status) => ({
	connectedCalendarCount: 0,
	events: [],
	status,
});

const syncedCalendarStateSchema = z.discriminatedUnion("status", [
	z.strictObject({
		connectedCalendarCount: z.number().int().nonnegative().optional(),
		events: z.tuple([]).optional(),
		status: z.enum(["not_connected", "error"]),
	}),
	z.strictObject({
		connectedCalendarCount: z.number().int().nonnegative(),
		events: z.array(z.unknown()),
		status: z.literal("ready"),
	}),
]);

const cloneCalendarState = (value) => ({
	...value,
	events: value.events.map((event) => ({
		...event,
		attendees: event.attendees.map((attendee) => ({ ...attendee })),
		recurrence: event.recurrence
			? {
					...event.recurrence,
					end: { ...event.recurrence.end },
					weekdays: [...event.recurrence.weekdays],
				}
			: undefined,
	})),
});

const normalizeSyncedCalendarState = (payload) => {
	const result = syncedCalendarStateSchema.safeParse(payload);
	if (!result.success) {
		throw new Error("Tray calendar payload is invalid.", {
			cause: result.error,
		});
	}
	const syncedState = result.data;

	if (syncedState.status !== "ready") {
		return createUnavailableCalendarResult(syncedState.status);
	}
	const events = syncedState.events.map(normalizeCalendarEventPayload);
	if (events.some((event) => event === null)) {
		throw new Error("Tray calendar contains an invalid event.");
	}

	return {
		connectedCalendarCount: syncedState.connectedCalendarCount,
		events,
		status: "ready",
	};
};

export const createDesktopSyncedCalendar = () => {
	let state = createUnavailableCalendarResult("not_connected");

	return {
		listCurrentDayEvents: async () => cloneCalendarState(state),
		setState: (payload) => {
			state = normalizeSyncedCalendarState(payload);
		},
	};
};
