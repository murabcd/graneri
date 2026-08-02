export type CalendarAttendeeResponseStatus =
	| "accepted"
	| "declined"
	| "needs_action"
	| "tentative"
	| "unknown";

export type CalendarEventAttendee = {
	displayName?: string;
	email: string;
	isOrganizer: boolean;
	isSelf: boolean;
	responseStatus: CalendarAttendeeResponseStatus;
};

export type CalendarEventPayload = {
	attendees: CalendarEventAttendee[];
	canDelete: boolean;
	canEdit: boolean;
	guestPermissions: "none" | "invite" | "manage";
	canMove: boolean;
	canRemove: boolean;
	id: string;
	calendarId: string;
	calendarName: string;
	description?: string;
	title: string;
	startAt: string;
	endAt: string;
	isAllDay: boolean;
	isMeeting: boolean;
	isRecurring: boolean;
	htmlLink?: string;
	meetingUrl?: string;
	location?: string;
	provider: "google" | "yandex";
	providerEventId: string;
	recurrence?: {
		end:
			| { kind: "never" }
			| { count: number; kind: "after_count" }
			| { date: string; kind: "on_date" };
		frequency: "daily" | "weekly" | "monthly" | "yearly" | "custom";
		interval: number;
		weekdays: Array<"sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat">;
	};
	recurrenceId?: string;
	seriesProviderEventId?: string;
};

export function normalizeCalendarEventPayload(
	value: unknown,
): CalendarEventPayload | null;

export function appendCalendarEventRequestSearchParam({
	requestId,
	searchParams,
}: {
	requestId: string;
	searchParams: URLSearchParams;
}): void;

export function getCalendarEventRequestIdFromSearchParams(
	searchParams: URLSearchParams,
): string | null;
