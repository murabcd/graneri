import { normalizeCalendarEventPayload } from "../../../packages/platform/src/calendar-event-navigation.mjs";
import { isRecord } from "./object-record.mjs";

const normalizeSyncedCalendarEvent = (event) =>
	normalizeCalendarEventPayload(event);

const createUnavailableCalendarResult = (status) => ({
	connectedCalendarCount: 0,
	events: [],
	status,
});

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
	if (!isRecord(payload)) {
		throw new Error("Tray calendar payload must be an object.");
	}

	if (payload.status === "not_connected" || payload.status === "error") {
		return createUnavailableCalendarResult(payload.status);
	}

	if (payload.status !== "ready") {
		throw new Error("Tray calendar status is invalid.");
	}

	return {
		connectedCalendarCount:
			typeof payload.connectedCalendarCount === "number"
				? payload.connectedCalendarCount
				: 0,
		events: Array.isArray(payload.events)
			? payload.events
					.map((event) => normalizeSyncedCalendarEvent(event))
					.filter(Boolean)
			: [],
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
