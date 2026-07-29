import electron from "electron";
import {
	appendNoteCaptureSearchParams,
	createNoteCaptureRequestId,
} from "../../../packages/platform/src/note-capture-navigation.mjs";
import {
	createInitialTrayCalendarState,
	createLoadingTrayCalendarState,
	createUnavailableTrayCalendarState,
	getDetectedMeetingCalendarEventFromEvents,
	scheduledMeetingReminderLeadTimeMs,
} from "./desktop-tray-calendar-detection.mjs";
import { logError } from "./logger.mjs";
import { toErrorLogDetails } from "./network.mjs";

const { shell: electronShell } = electron;

export {
	createInitialTrayCalendarState,
	createLoadingTrayCalendarState,
	createUnavailableTrayCalendarState,
	getDetectedMeetingCalendarEventFromEvents,
	getUpcomingTrayEventsForDay,
} from "./desktop-tray-calendar-detection.mjs";

const trayCalendarActiveRefreshMs = 60 * 1000;
const trayCalendarIdleRefreshMs = 5 * 60 * 1000;
const trayCalendarUnavailableRefreshMs = 15 * 60 * 1000;
const trayCalendarUpcomingRefreshWindowMs = 30 * 60 * 1000;

export const isTrayEventLive = (event, currentDate) => {
	const startAt = new Date(event.startAt).getTime();
	const endAt = new Date(event.endAt).getTime();
	const now = currentDate.getTime();

	return now >= startAt && now <= endAt;
};

const createScheduledMeetingReminderKey = (event) =>
	`${event.id}:${event.startAt}`;

const createCalendarEventNoteSearch = (event, options = {}) => {
	const searchParams = new URLSearchParams();
	const autoStartCapture = options.autoStartCapture === true;
	const stopCaptureWhenMeetingEnds =
		options.stopCaptureWhenMeetingEnds === true;

	appendNoteCaptureSearchParams({
		captureRequestId: autoStartCapture ? createNoteCaptureRequestId() : null,
		searchParams,
		stopCaptureWhenMeetingEnds,
	});

	searchParams.set("calendarEventId", event.id);
	searchParams.set("calendarId", event.calendarId);
	searchParams.set("calendarName", event.calendarName);
	searchParams.set("eventTitle", event.title);
	searchParams.set("startAt", event.startAt);
	searchParams.set("endAt", event.endAt);
	searchParams.set("isAllDay", event.isAllDay ? "1" : "0");

	if (event.meetingUrl) {
		searchParams.set("meetingUrl", event.meetingUrl);
	}

	if (event.location) {
		searchParams.set("location", event.location);
	}

	if (event.htmlLink) {
		searchParams.set("htmlLink", event.htmlLink);
	}

	return `?${searchParams.toString()}`;
};

export const createDesktopTrayCalendar = ({
	calendarSource,
	getNotificationPreferences,
	onOpenMainWindow,
	onShowScheduledMeetingReminder,
	onStateChange,
	shellApi = electronShell,
	shouldMaintainCalendar = () => process.platform === "darwin",
}) => {
	let state = createInitialTrayCalendarState();
	let refreshTimeoutId = null;
	let refreshPromise = null;
	let queuedRefreshOptions = null;
	const shownScheduledMeetingReminderKeys = new Set();

	const notifyStateChange = () => {
		try {
			onStateChange();
		} catch (error) {
			logError({
				error: toErrorLogDetails(error),
				message: "Failed to rebuild tray calendar menu.",
			});
		}
	};

	const openTrayMeetingLink = async (event) => {
		if (!event?.meetingUrl) {
			return;
		}

		await shellApi.openExternal(event.meetingUrl);
	};

	const openCalendarEventNote = async (event, options = {}) => {
		const hasStarted = new Date(event.startAt).getTime() <= Date.now();

		await onOpenMainWindow({
			pathname: "/note",
			search: createCalendarEventNoteSearch(event, {
				autoStartCapture:
					options.autoStartCapture === true ||
					(options.autoStartCapture == null && hasStarted),
				stopCaptureWhenMeetingEnds:
					options.stopCaptureWhenMeetingEnds === true ||
					(options.stopCaptureWhenMeetingEnds == null && event.isMeeting),
			}),
		});

		if (options.openMeetingLink !== false && event.meetingUrl) {
			await openTrayMeetingLink(event);
		}
	};

	const getDetectedMeetingCalendarEvent = (currentDate = new Date()) => {
		if (state.status !== "ready") {
			return null;
		}

		return getDetectedMeetingCalendarEventFromEvents(state.events, currentDate);
	};

	const hasReadyCalendarState = () => state.status === "ready";

	const clearRefresh = () => {
		if (refreshTimeoutId != null) {
			clearTimeout(refreshTimeoutId);
			refreshTimeoutId = null;
		}
	};

	const shouldUseActiveRefresh = (events) => {
		const now = Date.now();

		return events.some((event) => {
			if (!event?.isMeeting || event.isAllDay) {
				return false;
			}

			const startAt = Date.parse(event.startAt);
			const endAt = Date.parse(event.endAt);

			if (
				!Number.isFinite(startAt) ||
				!Number.isFinite(endAt) ||
				endAt <= now
			) {
				return false;
			}

			return startAt - now <= trayCalendarUpcomingRefreshWindowMs;
		});
	};

	const getRefreshDelay = () => {
		if (!shouldMaintainCalendar()) {
			return null;
		}

		if (state.status === "ready" && shouldUseActiveRefresh(state.events)) {
			return trayCalendarActiveRefreshMs;
		}

		if (state.status === "ready") {
			return trayCalendarIdleRefreshMs;
		}

		return trayCalendarUnavailableRefreshMs;
	};

	const scheduleRefresh = ({ delayMs, keepOpenInMenuBar } = {}) => {
		clearRefresh();
		const resolvedDelayMs = delayMs ?? getRefreshDelay();

		if (resolvedDelayMs == null) {
			return;
		}

		refreshTimeoutId = setTimeout(() => {
			refreshTimeoutId = null;
			void refresh({ keepOpenInMenuBar });
		}, resolvedDelayMs);
	};

	const syncShownScheduledMeetingReminders = (events) => {
		const activeEventKeys = new Set(
			events.map((event) => createScheduledMeetingReminderKey(event)),
		);

		for (const key of shownScheduledMeetingReminderKeys) {
			if (!activeEventKeys.has(key)) {
				shownScheduledMeetingReminderKeys.delete(key);
			}
		}
	};

	const maybeShowScheduledMeetingReminders = async (events) => {
		if (!getNotificationPreferences().notifyForScheduledMeetings) {
			return;
		}

		const now = Date.now();
		syncShownScheduledMeetingReminders(events);

		for (const event of events) {
			if (!event?.isMeeting || event.isAllDay) {
				continue;
			}

			const startAt = new Date(event.startAt).getTime();
			const endAt = new Date(event.endAt).getTime();

			if (
				!Number.isFinite(startAt) ||
				!Number.isFinite(endAt) ||
				endAt <= now ||
				startAt - now > scheduledMeetingReminderLeadTimeMs
			) {
				continue;
			}

			const reminderKey = createScheduledMeetingReminderKey(event);

			if (shownScheduledMeetingReminderKeys.has(reminderKey)) {
				continue;
			}

			shownScheduledMeetingReminderKeys.add(reminderKey);

			try {
				await onShowScheduledMeetingReminder(event);
			} catch (error) {
				shownScheduledMeetingReminderKeys.delete(reminderKey);
				logError({
					error: toErrorLogDetails(error),
					message: "Failed to show scheduled meeting reminder.",
				});
			}
		}
	};

	const queueRefresh = ({ keepOpenInMenuBar } = {}) => {
		queuedRefreshOptions = {
			keepOpenInMenuBar:
				keepOpenInMenuBar ?? queuedRefreshOptions?.keepOpenInMenuBar,
		};
	};

	const runRefresh = async ({ keepOpenInMenuBar } = {}) => {
		try {
			if (!shouldMaintainCalendar()) {
				state = createInitialTrayCalendarState();
				return;
			}

			if (!hasReadyCalendarState()) {
				state = createLoadingTrayCalendarState({ previousState: state });
				notifyStateChange();
			}

			try {
				const result = await calendarSource.listCurrentDayEvents();

				state =
					result && typeof result === "object" && result.status === "ready"
						? {
								status: "ready",
								events: Array.isArray(result.events) ? result.events : [],
								connectedCalendarCount:
									typeof result.connectedCalendarCount === "number"
										? result.connectedCalendarCount
										: 0,
							}
						: createUnavailableTrayCalendarState({
								status: "not_connected",
							});

				if (state.status === "ready") {
					await maybeShowScheduledMeetingReminders(state.events);
				} else {
					syncShownScheduledMeetingReminders([]);
				}
			} catch (error) {
				logError({
					error: toErrorLogDetails(error),
					message: "Failed to refresh tray calendar.",
				});
				if (!hasReadyCalendarState()) {
					state = createUnavailableTrayCalendarState({
						previousState: state,
						status: "error",
					});
				}
			}
		} finally {
			notifyStateChange();
			scheduleRefresh({ keepOpenInMenuBar });
		}
	};

	const refresh = async ({ keepOpenInMenuBar } = {}) => {
		if (refreshPromise) {
			queueRefresh({ keepOpenInMenuBar });
			return await refreshPromise;
		}

		refreshPromise = (async () => {
			let refreshOptions = { keepOpenInMenuBar };

			while (refreshOptions) {
				queuedRefreshOptions = null;
				await runRefresh(refreshOptions);
				refreshOptions = queuedRefreshOptions;
			}
		})();

		try {
			return await refreshPromise;
		} finally {
			refreshPromise = null;
		}
	};

	return {
		clearRefresh,
		getDetectedMeetingCalendarEvent,
		getState: () => ({
			...state,
			events: state.events.map((event) => ({ ...event })),
			hasRefreshPromise: Boolean(refreshPromise),
			hasRefreshTimeout: refreshTimeoutId != null,
		}),
		openCalendarEventNote,
		refresh,
		scheduleRefresh,
	};
};
