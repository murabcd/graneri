export type CalendarProvider = "google" | "yandex";

export type CalendarSource = {
	canCreateEvents: boolean;
	color: string;
	id: string;
	name: string;
	provider: CalendarProvider;
};

export type UpcomingCalendarEvent = {
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
	recurrenceId?: string;
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
	time: CalendarEventTime;
	title: string;
};

export type CreateCalendarEventInput = CalendarEventDetailsInput & {
	provider: CalendarProvider;
};

export type UpdateCalendarEventInput = {
	calendarId: string;
	description?: string;
	location?: string;
	providerEventId: string;
	recurrenceId?: string;
	recurrenceIsAllDay?: boolean;
	time: CalendarEventTime;
	title: string;
};
