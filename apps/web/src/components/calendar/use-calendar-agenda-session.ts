import { useAction } from "convex/react";
import * as React from "react";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import {
	type CalendarRequestWindow,
	loadCalendarAgenda,
	readCalendarAgendaSnapshot,
	removeCalendarAgendaSnapshot,
	writeCalendarAgendaSnapshot,
} from "@/components/calendar/calendar-agenda-cache";
import type { CalendarEventCreation } from "@/components/calendar/calendar-event-draft";
import {
	type CalendarCreation,
	type CalendarSource,
	getCalendarAgendaRange,
	toCalendarRequestWindow,
	toCalendarSources,
} from "@/components/calendar/calendar-view-model";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { logError } from "@/lib/logger";
import { api } from "../../../../../convex/_generated/api";

export type CalendarAgendaSessionState =
	| {
			status: "loading";
			calendars: CalendarSource[];
			events: UpcomingCalendarEvent[];
			visibleWindow: CalendarRequestWindow;
			workspaceId: string | null;
	  }
	| {
			status: "ready";
			calendars: CalendarSource[];
			events: UpcomingCalendarEvent[];
			visibleWindow: CalendarRequestWindow;
			workspaceId: string;
	  }
	| {
			status: "not_connected";
			calendars: [];
			events: [];
			visibleWindow: CalendarRequestWindow;
			workspaceId: string | null;
	  }
	| {
			status: "error";
			calendars: CalendarSource[];
			events: UpcomingCalendarEvent[];
			visibleWindow: CalendarRequestWindow;
			workspaceId: string;
	  };

const getAdjacentRequestWindows = (
	requestWindow: CalendarRequestWindow,
): CalendarRequestWindow[] =>
	[-30, 30].map((dayCount) => {
		const start = new Date(requestWindow.timeMin);
		start.setDate(start.getDate() + dayCount);
		return toCalendarRequestWindow(getCalendarAgendaRange(start));
	});

const applyCalendarEventUpdate = (
	event: UpcomingCalendarEvent,
	update: CalendarEventCreation,
): UpcomingCalendarEvent => {
	if (update.time.kind === "timed") {
		return {
			...event,
			description: update.description,
			endAt: update.time.endAt,
			isAllDay: false,
			location: update.location,
			startAt: update.time.startAt,
			title: update.title,
		};
	}

	return {
		...event,
		description: update.description,
		endAt: new Date(
			new Date(`${update.time.endDate}T00:00:00`).getTime() - 1,
		).toISOString(),
		isAllDay: true,
		location: update.location,
		startAt: new Date(`${update.time.startDate}T00:00:00`).toISOString(),
		title: update.title,
	};
};

const isSameCalendarEvent = (
	left: UpcomingCalendarEvent,
	right: UpcomingCalendarEvent,
) =>
	left.provider === right.provider &&
	left.calendarId === right.calendarId &&
	left.providerEventId === right.providerEventId &&
	left.recurrenceId === right.recurrenceId;

const updateCachedCalendarEvents = ({
	requestWindow,
	transform,
	workspaceId,
}: {
	requestWindow: CalendarRequestWindow;
	transform: (events: UpcomingCalendarEvent[]) => UpcomingCalendarEvent[];
	workspaceId: string;
}) => {
	const snapshot = readCalendarAgendaSnapshot(workspaceId, requestWindow);

	if (snapshot) {
		writeCalendarAgendaSnapshot(workspaceId, requestWindow, {
			...snapshot,
			events: transform(snapshot.events),
		});
	}
};

const createInitialState = (
	workspaceId: string | null,
	requestWindow: CalendarRequestWindow,
): CalendarAgendaSessionState => {
	if (workspaceId) {
		const snapshot = readCalendarAgendaSnapshot(workspaceId, requestWindow);
		if (snapshot) {
			return {
				status: "ready",
				...snapshot,
				visibleWindow: requestWindow,
				workspaceId,
			};
		}
	}

	return {
		status: "loading",
		calendars: [],
		events: [],
		visibleWindow: requestWindow,
		workspaceId,
	};
};

export function useCalendarAgendaSession() {
	const activeWorkspaceId = useActiveWorkspaceId();
	const createCalendarAction = useAction(api.calendar.createCalendar);
	const createCalendarEventAction = useAction(api.calendar.createCalendarEvent);
	const deleteCalendarEventAction = useAction(api.calendar.deleteCalendarEvent);
	const listCalendarEvents = useAction(api.calendar.listCalendarEvents);
	const updateCalendarEventAction = useAction(api.calendar.updateCalendarEvent);
	const [requestWindow, setRequestWindow] = React.useState(() =>
		toCalendarRequestWindow(getCalendarAgendaRange(new Date())),
	);
	const [agendaRevision, setAgendaRevision] = React.useState(0);
	const [state, setState] = React.useState<CalendarAgendaSessionState>(() =>
		createInitialState(activeWorkspaceId, requestWindow),
	);
	const retry = React.useCallback(() => {
		setAgendaRevision((current) => current + 1);
	}, []);
	const createEvent = React.useCallback(
		async (event: CalendarEventCreation) => {
			if (!activeWorkspaceId) {
				throw new Error("Select a workspace before creating an event.");
			}

			await createCalendarEventAction({
				workspaceId: activeWorkspaceId,
				...event,
			});
			setAgendaRevision((current) => current + 1);
		},
		[activeWorkspaceId, createCalendarEventAction],
	);
	const createCalendar = React.useCallback(
		async (calendar: CalendarCreation) => {
			if (!activeWorkspaceId) {
				throw new Error("Select a workspace before creating a calendar.");
			}

			await createCalendarAction({
				workspaceId: activeWorkspaceId,
				...calendar,
			});
			setAgendaRevision((current) => current + 1);
		},
		[activeWorkspaceId, createCalendarAction],
	);
	const updateEvent = React.useCallback(
		async (event: UpcomingCalendarEvent, update: CalendarEventCreation) => {
			if (!activeWorkspaceId) {
				throw new Error("Select a workspace before updating an event.");
			}

			await updateCalendarEventAction({
				workspaceId: activeWorkspaceId,
				calendarId: event.calendarId,
				description: update.description,
				location: update.location,
				provider: event.provider,
				providerEventId: event.providerEventId,
				recurrenceId: event.recurrenceId,
				recurrenceIsAllDay: event.recurrenceId ? event.isAllDay : undefined,
				time: update.time,
				title: update.title,
			});
			const transformEvents = (events: UpcomingCalendarEvent[]) =>
				events.map((candidate) =>
					isSameCalendarEvent(candidate, event)
						? applyCalendarEventUpdate(candidate, update)
						: candidate,
				);
			updateCachedCalendarEvents({
				requestWindow: state.visibleWindow,
				transform: transformEvents,
				workspaceId: activeWorkspaceId,
			});
			setState((current) =>
				current.status === "not_connected"
					? current
					: {
							...current,
							events: transformEvents(current.events),
						},
			);
			setAgendaRevision((current) => current + 1);
		},
		[activeWorkspaceId, state.visibleWindow, updateCalendarEventAction],
	);
	const deleteEvent = React.useCallback(
		async (event: UpcomingCalendarEvent) => {
			if (!activeWorkspaceId) {
				throw new Error("Select a workspace before deleting an event.");
			}

			await deleteCalendarEventAction({
				workspaceId: activeWorkspaceId,
				calendarId: event.calendarId,
				provider: event.provider,
				providerEventId: event.providerEventId,
				recurrenceId: event.recurrenceId,
				recurrenceIsAllDay: event.recurrenceId ? event.isAllDay : undefined,
			});
			const transformEvents = (events: UpcomingCalendarEvent[]) =>
				events.filter((candidate) => !isSameCalendarEvent(candidate, event));
			updateCachedCalendarEvents({
				requestWindow: state.visibleWindow,
				transform: transformEvents,
				workspaceId: activeWorkspaceId,
			});
			setState((current) =>
				current.status === "not_connected"
					? current
					: {
							...current,
							events: transformEvents(current.events),
						},
			);
			setAgendaRevision((current) => current + 1);
		},
		[activeWorkspaceId, deleteCalendarEventAction, state.visibleWindow],
	);
	const range = React.useMemo(
		() => ({
			start: new Date(state.visibleWindow.timeMin),
			end: new Date(state.visibleWindow.timeMax),
		}),
		[state.visibleWindow],
	);
	const agendaRequest = React.useMemo(
		() => ({
			revision: agendaRevision,
			window: requestWindow,
		}),
		[agendaRevision, requestWindow],
	);

	React.useEffect(() => {
		let cancelled = false;
		const targetWindow = agendaRequest.window;
		if (!activeWorkspaceId) {
			setState({
				status: "not_connected",
				calendars: [],
				events: [],
				visibleWindow: targetWindow,
				workspaceId: null,
			});
			return;
		}

		const loadAgenda = (window: CalendarRequestWindow) =>
			loadCalendarAgenda(activeWorkspaceId, window, () =>
				listCalendarEvents({
					workspaceId: activeWorkspaceId,
					...window,
				}),
			);
		const prefetchAdjacentAgendas = () => {
			for (const adjacentWindow of getAdjacentRequestWindows(targetWindow)) {
				if (
					readCalendarAgendaSnapshot(activeWorkspaceId, adjacentWindow) !== null
				) {
					continue;
				}

				void loadAgenda(adjacentWindow)
					.then((result) => {
						if (result.status === "not_connected") {
							return;
						}

						writeCalendarAgendaSnapshot(activeWorkspaceId, adjacentWindow, {
							calendars: toCalendarSources(result.calendars),
							events: result.events,
						});
					})
					.catch((error: unknown) => {
						logError({
							event: "client.error",
							error,
							message: "Failed to prefetch adjacent calendar view",
						});
					});
			}
		};
		const snapshot = readCalendarAgendaSnapshot(
			activeWorkspaceId,
			targetWindow,
		);
		if (snapshot) {
			setState({
				status: "ready",
				...snapshot,
				visibleWindow: targetWindow,
				workspaceId: activeWorkspaceId,
			});
			prefetchAdjacentAgendas();
		} else {
			setState((current) =>
				current.workspaceId === activeWorkspaceId
					? { ...current, status: "loading" }
					: {
							status: "loading",
							calendars: [],
							events: [],
							visibleWindow: targetWindow,
							workspaceId: activeWorkspaceId,
						},
			);
		}

		void loadAgenda(targetWindow)
			.then((result) => {
				if (cancelled) {
					return;
				}

				if (result.status === "not_connected") {
					removeCalendarAgendaSnapshot(activeWorkspaceId, targetWindow);
					setState({
						status: "not_connected",
						calendars: [],
						events: [],
						visibleWindow: targetWindow,
						workspaceId: activeWorkspaceId,
					});
					return;
				}

				const nextSnapshot = {
					calendars: toCalendarSources(result.calendars),
					events: result.events,
				};
				writeCalendarAgendaSnapshot(
					activeWorkspaceId,
					targetWindow,
					nextSnapshot,
				);
				setState({
					status: "ready",
					...nextSnapshot,
					visibleWindow: targetWindow,
					workspaceId: activeWorkspaceId,
				});
				if (!snapshot) {
					prefetchAdjacentAgendas();
				}
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}

				logError({
					event: "client.error",
					error,
					message: "Failed to load calendar view",
				});
				setState((current) =>
					current.workspaceId === activeWorkspaceId
						? {
								...current,
								status: "error",
								workspaceId: activeWorkspaceId,
							}
						: {
								status: "error",
								calendars: [],
								events: [],
								visibleWindow: targetWindow,
								workspaceId: activeWorkspaceId,
							},
				);
			});

		return () => {
			cancelled = true;
		};
	}, [activeWorkspaceId, agendaRequest, listCalendarEvents]);

	const setAgendaStart = React.useCallback(
		(date: Date) => {
			const nextRequestWindow = toCalendarRequestWindow(
				getCalendarAgendaRange(date),
			);

			if (
				nextRequestWindow.timeMin === requestWindow.timeMin &&
				nextRequestWindow.timeMax === requestWindow.timeMax
			) {
				return;
			}

			const snapshot = activeWorkspaceId
				? readCalendarAgendaSnapshot(activeWorkspaceId, nextRequestWindow)
				: null;
			if (snapshot && activeWorkspaceId) {
				setState({
					status: "ready",
					...snapshot,
					visibleWindow: nextRequestWindow,
					workspaceId: activeWorkspaceId,
				});
			} else {
				setState((current) =>
					current.workspaceId === activeWorkspaceId
						? { ...current, status: "loading" }
						: {
								status: "loading",
								calendars: [],
								events: [],
								visibleWindow: nextRequestWindow,
								workspaceId: activeWorkspaceId,
							},
				);
			}
			setRequestWindow(nextRequestWindow);
		},
		[activeWorkspaceId, requestWindow],
	);
	const shiftRange = React.useCallback(
		(dayCount: number) => {
			const next = new Date(requestWindow.timeMin);
			next.setDate(next.getDate() + dayCount);
			setAgendaStart(next);
		},
		[requestWindow.timeMin, setAgendaStart],
	);

	return {
		activeWorkspaceId,
		createCalendar,
		createEvent,
		deleteEvent,
		range,
		retry,
		setAgendaStart,
		shiftRange,
		state,
		updateEvent,
	};
}
