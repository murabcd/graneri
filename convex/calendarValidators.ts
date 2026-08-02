import { v } from "convex/values";

export const calendarAttendeeResponseStatusValidator = v.union(
	v.literal("accepted"),
	v.literal("declined"),
	v.literal("needs_action"),
	v.literal("tentative"),
	v.literal("unknown"),
);

export const calendarAttendeeValidator = v.object({
	displayName: v.optional(v.string()),
	email: v.string(),
	isOrganizer: v.boolean(),
	isSelf: v.boolean(),
	responseStatus: calendarAttendeeResponseStatusValidator,
});

export const calendarGuestPermissionsValidator = v.union(
	v.literal("none"),
	v.literal("invite"),
	v.literal("manage"),
);

const calendarWeekdayValidator = v.union(
	v.literal("sun"),
	v.literal("mon"),
	v.literal("tue"),
	v.literal("wed"),
	v.literal("thu"),
	v.literal("fri"),
	v.literal("sat"),
);

const calendarRecurrenceFields = {
	interval: v.number(),
	weekdays: v.array(calendarWeekdayValidator),
};

const calendarRecurrenceValidator = v.object({
	...calendarRecurrenceFields,
	end: v.union(
		v.object({ kind: v.literal("never") }),
		v.object({ count: v.number(), kind: v.literal("after_count") }),
		v.object({ date: v.string(), kind: v.literal("on_date") }),
	),
	frequency: v.union(
		v.literal("daily"),
		v.literal("weekly"),
		v.literal("monthly"),
		v.literal("yearly"),
		v.literal("custom"),
	),
});

export const calendarEventRecurrenceInputValidator = v.object({
	...calendarRecurrenceFields,
	end: v.union(
		v.object({ kind: v.literal("never") }),
		v.object({ date: v.string(), kind: v.literal("on_date") }),
	),
	frequency: v.union(
		v.literal("daily"),
		v.literal("weekly"),
		v.literal("monthly"),
		v.literal("yearly"),
	),
	timeZone: v.string(),
});

export const upcomingCalendarEventValidator = v.object({
	attendees: v.array(calendarAttendeeValidator),
	canDelete: v.boolean(),
	canEdit: v.boolean(),
	guestPermissions: calendarGuestPermissionsValidator,
	canMove: v.boolean(),
	canRemove: v.boolean(),
	calendarId: v.string(),
	calendarName: v.string(),
	description: v.optional(v.string()),
	endAt: v.string(),
	htmlLink: v.optional(v.string()),
	id: v.string(),
	isAllDay: v.boolean(),
	isMeeting: v.boolean(),
	isRecurring: v.boolean(),
	location: v.optional(v.string()),
	meetingUrl: v.optional(v.string()),
	provider: v.union(v.literal("google"), v.literal("yandex")),
	providerEventId: v.string(),
	recurrence: v.optional(calendarRecurrenceValidator),
	recurrenceId: v.optional(v.string()),
	seriesProviderEventId: v.optional(v.string()),
	startAt: v.string(),
	title: v.string(),
});

export const calendarEventSnapshotValidator = upcomingCalendarEventValidator
	.omit("attendees")
	.omit("canDelete")
	.omit("canEdit")
	.omit("guestPermissions")
	.omit("canMove")
	.omit("canRemove")
	.extend({ key: v.string() });

const calendarSourceValidator = v.object({
	canCreateEvents: v.boolean(),
	canEdit: v.boolean(),
	canSetDefault: v.boolean(),
	color: v.string(),
	id: v.string(),
	name: v.string(),
	provider: v.union(v.literal("google"), v.literal("yandex")),
	removalMode: v.union(
		v.literal("delete"),
		v.literal("none"),
		v.literal("unsubscribe"),
	),
	requiresEventMove: v.boolean(),
});

export const calendarEventTimeValidator = v.union(
	v.object({
		endDate: v.string(),
		kind: v.literal("all_day"),
		startDate: v.string(),
	}),
	v.object({
		endAt: v.string(),
		kind: v.literal("timed"),
		startAt: v.string(),
	}),
);

export const calendarProviderValidator = v.union(
	v.literal("google"),
	v.literal("yandex"),
);

export const upcomingEventsResponseValidator = v.union(
	v.object({
		events: v.array(upcomingCalendarEventValidator),
		status: v.literal("not_connected"),
	}),
	v.object({
		connectedCalendarCount: v.number(),
		events: v.array(upcomingCalendarEventValidator),
		status: v.literal("ready"),
	}),
);

export const calendarEventsResponseValidator = v.union(
	v.object({
		calendars: v.array(calendarSourceValidator),
		events: v.array(upcomingCalendarEventValidator),
		status: v.literal("not_connected"),
	}),
	v.object({
		calendars: v.array(calendarSourceValidator),
		events: v.array(upcomingCalendarEventValidator),
		status: v.literal("ready"),
	}),
);

const calendarToolSourceValidator = v.object({
	title: v.string(),
	type: v.literal("url"),
	url: v.string(),
});

export const calendarToolResponseValidator = v.object({
	connection: v.string(),
	events: v.array(upcomingCalendarEventValidator),
	sources: v.array(calendarToolSourceValidator),
});
