export type CalendarProvider = "google" | "yandex";

export type CalendarRemovalMode = "delete" | "none" | "unsubscribe";

export type CalendarGuestPermissions = "none" | "invite" | "manage";

export type CalendarWeekday =
	| "sun"
	| "mon"
	| "tue"
	| "wed"
	| "thu"
	| "fri"
	| "sat";

export type CalendarRecurrenceEnd =
	| { kind: "never" }
	| { count: number; kind: "after_count" }
	| { date: string; kind: "on_date" };

export type CalendarRecurrence = {
	end: CalendarRecurrenceEnd;
	frequency: "daily" | "weekly" | "monthly" | "yearly" | "custom";
	interval: number;
	weekdays: CalendarWeekday[];
};

export type CalendarEventRecurrenceInput = {
	end: { kind: "never" } | { date: string; kind: "on_date" };
	frequency: Exclude<CalendarRecurrence["frequency"], "custom">;
	interval: number;
	timeZone: string;
	weekdays: CalendarWeekday[];
};

export type CalendarAttendeeResponseStatus =
	| "accepted"
	| "declined"
	| "needs_action"
	| "tentative"
	| "unknown";

export type CalendarAttendee = {
	displayName?: string;
	email: string;
	isOrganizer: boolean;
	isSelf: boolean;
	responseStatus: CalendarAttendeeResponseStatus;
};

export type CalendarSource = {
	canCreateEvents: boolean;
	canEdit: boolean;
	canSetDefault: boolean;
	color: string;
	id: string;
	name: string;
	provider: CalendarProvider;
	removalMode: CalendarRemovalMode;
	requiresEventMove: boolean;
};

export type UpcomingCalendarEvent = {
	attendees: CalendarAttendee[];
	canDelete: boolean;
	canEdit: boolean;
	guestPermissions: CalendarGuestPermissions;
	canMove: boolean;
	canRemove: boolean;
	calendarId: string;
	calendarName: string;
	description?: string;
	endAt: string;
	htmlLink?: string;
	id: string;
	isAllDay: boolean;
	isMeeting: boolean;
	isRecurring: boolean;
	location?: string;
	meetingUrl?: string;
	provider: CalendarProvider;
	providerEventId: string;
	recurrence?: CalendarRecurrence;
	recurrenceId?: string;
	seriesProviderEventId?: string;
	startAt: string;
	title: string;
};

export type CalendarEventsFetchResult = {
	calendars: CalendarSource[];
	connectedCalendarCount: number;
	events: UpcomingCalendarEvent[];
};

export type CalendarEventTime =
	| {
			kind: "all_day";
			endDate: string;
			startDate: string;
	  }
	| {
			kind: "timed";
			endAt: string;
			startAt: string;
	  };

export type CalendarEventDetailsInput = {
	calendarId: string;
	description?: string;
	guests: string[];
	location?: string;
	recurrence?: CalendarEventRecurrenceInput;
	time: CalendarEventTime;
	title: string;
};

export type CreateCalendarEventInput = CalendarEventDetailsInput & {
	provider: CalendarProvider;
};

export type UpdateCalendarEventInput = {
	calendarId: string;
	destinationCalendarId: string;
	description?: string;
	guests: string[];
	location?: string;
	providerEventId: string;
	recurrenceId?: string;
	recurrenceIsAllDay?: boolean;
	seriesProviderEventId?: string;
	time: CalendarEventTime;
	title: string;
};
