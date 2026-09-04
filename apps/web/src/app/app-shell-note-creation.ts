import type { AppView, UpcomingCalendarEvent } from "@/app/app-types";
import { getNoteCaptureRequestIdForAutoStart } from "@/lib/note-capture-request";
import type { Id } from "../../../../convex/_generated/dataModel";

export const scheduleNoteCaptureAutoStart = ({
	clearScheduledAutoStart,
	currentNoteId,
	currentView,
	scheduledAtValue,
	shouldAutoStart,
	triggerScheduledAutoStart,
}: {
	clearScheduledAutoStart: () => void;
	currentNoteId: Id<"notes"> | null;
	currentView: AppView;
	scheduledAtValue: string | null | undefined;
	shouldAutoStart: boolean;
	triggerScheduledAutoStart: () => void;
}) => {
	if (
		currentView !== "note" ||
		!currentNoteId ||
		shouldAutoStart ||
		!scheduledAtValue
	)
		return;
	const scheduledAt = new Date(scheduledAtValue).getTime();
	if (Number.isNaN(scheduledAt)) {
		clearScheduledAutoStart();
		return;
	}
	if (scheduledAt <= Date.now()) {
		triggerScheduledAutoStart();
		return;
	}
	const timeoutId = window.setTimeout(
		triggerScheduledAutoStart,
		scheduledAt - Date.now(),
	);
	return () => window.clearTimeout(timeoutId);
};

export type AppShellCreateNoteOptions = {
	autoStartCapture?: boolean;
	calendarEvent?: UpcomingCalendarEvent | null;
	captureRequestId?: string | null;
	projectId: Id<"projects"> | null;
};

export const getAppShellNoteCreationIntent = (
	options: AppShellCreateNoteOptions,
) => {
	const shouldStartCapture = options.autoStartCapture === true;
	const calendarEvent = options.calendarEvent ?? null;
	return {
		calendarEvent,
		captureRequestId: getNoteCaptureRequestIdForAutoStart({
			autoStartCapture: shouldStartCapture,
			captureRequestId: options.captureRequestId,
		}),
		projectId: options.projectId,
		scheduledAutoStartAt:
			options.autoStartCapture === false && calendarEvent
				? calendarEvent.startAt
				: null,
		shouldStartCapture,
	};
};

export const createAppShellNote = <T>({
	calendarEvent,
	createCalendarNote,
	createPlainNote,
}: {
	calendarEvent: UpcomingCalendarEvent | null;
	createCalendarNote: (calendarEvent: UpcomingCalendarEvent) => Promise<T>;
	createPlainNote: () => Promise<T>;
}) => (calendarEvent ? createCalendarNote(calendarEvent) : createPlainNote());
