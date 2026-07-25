"use node";

import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { action } from "./_generated/server";
import type {
	CalendarEventDetailsInput,
	CalendarEventsFetchResult,
	CalendarSource,
	UpcomingCalendarEvent,
	UpdateCalendarEventInput,
} from "./calendarTypes";
import {
	calendarEventsResponseValidator,
	calendarEventTimeValidator,
	calendarProviderValidator,
	calendarToolResponseValidator,
	upcomingEventsResponseValidator,
} from "./calendarValidators";
import { getGoogleAuthContext } from "./googleAuth";
import {
	createGoogleCalendar,
	createGoogleCalendarEvent,
	deleteGoogleCalendarEvent,
	fetchGoogleCalendarEvents,
	updateGoogleCalendarEvent,
} from "./googleCalendar";
import {
	createYandexCalendar,
	createYandexCalendarEvent,
	deleteYandexCalendarEvent,
	listYandexUpcomingEvents,
	updateYandexCalendarEvent,
} from "./yandexCalendar";

const UPCOMING_EVENTS_LIMIT = 12;
const CALENDAR_EVENTS_LIMIT = 250;
const CALENDAR_VIEW_MAX_WINDOW_MS = 62 * 24 * 60 * 60 * 1000;
const CALENDAR_TOOL_EVENT_LIMIT = 10;
const CALENDAR_TOOL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const CALENDAR_TOOL_LOOKAHEAD_MS = 180 * 24 * 60 * 60 * 1000;

type CalendarVisibilityPreferences = {
	showGoogleCalendar: boolean;
	showGoogleDrive: boolean;
	showYandexCalendar: boolean;
};

type YandexCalendarConnection = {
	provider: "yandex-calendar";
	displayName: string;
	email: string;
	password: string;
	serverAddress: string;
	calendarHomePath: string;
};

type UpcomingEventsResponse =
	| {
			status: "not_connected";
			events: UpcomingCalendarEvent[];
	  }
	| {
			status: "ready";
			events: UpcomingCalendarEvent[];
			connectedCalendarCount: number;
	  };

type CalendarEventsResponse =
	| {
			status: "not_connected";
			calendars: CalendarSource[];
			events: UpcomingCalendarEvent[];
	  }
	| {
			status: "ready";
			calendars: CalendarSource[];
			events: UpcomingCalendarEvent[];
	  };

type RequestedCalendarWindow = {
	timeMin: number;
	timeMax: number;
};

const getRequestedCalendarWindow = ({
	timeMax,
	timeMin,
}: {
	timeMax: string;
	timeMin: string;
}): RequestedCalendarWindow => {
	const parsedTimeMin = new Date(timeMin).getTime();
	const parsedTimeMax = new Date(timeMax).getTime();

	if (
		!Number.isFinite(parsedTimeMin) ||
		!Number.isFinite(parsedTimeMax) ||
		parsedTimeMax <= parsedTimeMin
	) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_WINDOW",
			message: "Calendar window is invalid.",
		});
	}

	return {
		timeMin: parsedTimeMin,
		timeMax: parsedTimeMax,
	};
};

const getCalendarViewWindow = ({
	timeMax,
	timeMin,
}: {
	timeMax: string;
	timeMin: string;
}) => {
	const requestedWindow = getRequestedCalendarWindow({ timeMax, timeMin });

	if (
		requestedWindow.timeMax - requestedWindow.timeMin >
		CALENDAR_VIEW_MAX_WINDOW_MS
	) {
		throw new ConvexError({
			code: "CALENDAR_WINDOW_TOO_LARGE",
			message: "Calendar view window is too large.",
		});
	}

	return requestedWindow;
};

const sortCalendarEvents = (events: UpcomingCalendarEvent[]) =>
	[...events].sort(
		(left, right) =>
			new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
	);

const sortAndLimitUpcomingEvents = (events: UpcomingCalendarEvent[]) =>
	sortCalendarEvents(events).slice(0, UPCOMING_EVENTS_LIMIT);

const dedupeUpcomingEvents = (events: UpcomingCalendarEvent[]) => {
	const dedupedEvents = new Map<string, UpcomingCalendarEvent>();

	for (const event of events) {
		const key = `${event.id}:${event.startAt}`;

		if (!dedupedEvents.has(key)) {
			dedupedEvents.set(key, event);
		}
	}

	return Array.from(dedupedEvents.values());
};

const getYandexCalendarConnection = async ({
	ctx,
	ownerTokenIdentifier,
	workspaceId,
}: {
	ctx: ActionCtx;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
}): Promise<YandexCalendarConnection | null> =>
	await ctx.runQuery(internal.appConnections.getYandexCalendarCredentials, {
		ownerTokenIdentifier,
		workspaceId,
	});

const fetchYandexUpcomingEvents = async ({
	ctx,
	now,
	timeMax,
	timeMin,
	workspaceId,
}: {
	ctx: ActionCtx;
	now: number;
	timeMax: number;
	timeMin: number;
	workspaceId: Id<"workspaces">;
}): Promise<CalendarEventsFetchResult> => {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		return {
			calendars: [],
			connectedCalendarCount: 0,
			events: [],
		};
	}

	const connection = await getYandexCalendarConnection({
		ctx,
		ownerTokenIdentifier: identity.tokenIdentifier,
		workspaceId,
	});

	if (!connection) {
		return {
			calendars: [],
			connectedCalendarCount: 0,
			events: [],
		};
	}

	return await listYandexUpcomingEvents({
		connection,
		now,
		timeMax,
		timeMin,
	});
};

const dedupeCalendarSources = (calendars: CalendarSource[]) => {
	const uniqueCalendars = new Map<string, CalendarSource>();

	for (const calendar of calendars) {
		if (!uniqueCalendars.has(calendar.id)) {
			uniqueCalendars.set(calendar.id, calendar);
		}
	}

	return Array.from(uniqueCalendars.values()).sort((left, right) =>
		left.name.localeCompare(right.name),
	);
};

const fetchWorkspaceCalendarEvents = async ({
	ctx,
	eventLimit,
	minimumEndAt,
	requestedWindow,
	workspaceId,
}: {
	ctx: ActionCtx;
	eventLimit: number;
	minimumEndAt: number;
	requestedWindow: RequestedCalendarWindow;
	workspaceId: Id<"workspaces">;
}): Promise<CalendarEventsFetchResult> => {
	const calendarVisibilityPreferences: CalendarVisibilityPreferences =
		await ctx.runQuery(api.calendarPreferences.get, {
			workspaceId,
		});

	if (
		!calendarVisibilityPreferences.showGoogleCalendar &&
		!calendarVisibilityPreferences.showYandexCalendar
	) {
		return {
			calendars: [],
			connectedCalendarCount: 0,
			events: [],
		};
	}

	const authContext = calendarVisibilityPreferences.showGoogleCalendar
		? await getGoogleAuthContext(ctx)
		: null;
	const [googleCalendarResult, yandexCalendarResult] = await Promise.all([
		calendarVisibilityPreferences.showGoogleCalendar && authContext
			? fetchGoogleCalendarEvents({
					authContext,
					eventLimit,
					minimumEndAt,
					timeMin: new Date(requestedWindow.timeMin).toISOString(),
					timeMax: new Date(requestedWindow.timeMax).toISOString(),
				})
			: Promise.resolve({
					calendars: [],
					connectedCalendarCount: 0,
					events: [],
				}),
		calendarVisibilityPreferences.showYandexCalendar
			? fetchYandexUpcomingEvents({
					ctx,
					now: minimumEndAt,
					timeMin: requestedWindow.timeMin,
					timeMax: requestedWindow.timeMax,
					workspaceId,
				})
			: Promise.resolve({
					calendars: [],
					connectedCalendarCount: 0,
					events: [],
				}),
	]);

	return {
		calendars: dedupeCalendarSources([
			...googleCalendarResult.calendars,
			...yandexCalendarResult.calendars,
		]),
		connectedCalendarCount:
			googleCalendarResult.connectedCalendarCount +
			yandexCalendarResult.connectedCalendarCount,
		events: dedupeUpcomingEvents([
			...googleCalendarResult.events,
			...yandexCalendarResult.events,
		]),
	};
};

export const listUpcomingGoogleEvents = action({
	args: {
		workspaceId: v.id("workspaces"),
		timeMax: v.string(),
		timeMin: v.string(),
	},
	returns: upcomingEventsResponseValidator,
	handler: async (ctx, args): Promise<UpcomingEventsResponse> => {
		const identity = await ctx.auth.getUserIdentity();

		if (!identity) {
			return {
				status: "not_connected" as const,
				events: [],
			};
		}

		try {
			const requestedWindow = getRequestedCalendarWindow(args);
			const result = await fetchWorkspaceCalendarEvents({
				ctx,
				eventLimit: UPCOMING_EVENTS_LIMIT,
				minimumEndAt: Date.now(),
				requestedWindow,
				workspaceId: args.workspaceId,
			});
			const events = sortAndLimitUpcomingEvents(
				result.events.filter((event) => event.isMeeting),
			);

			if (result.connectedCalendarCount === 0) {
				return {
					status: "not_connected" as const,
					events: [],
				};
			}

			return {
				status: "ready" as const,
				events,
				connectedCalendarCount: result.connectedCalendarCount,
			};
		} catch (error) {
			if (error instanceof Error && "status" in error && error.status === 401) {
				return {
					status: "not_connected" as const,
					events: [],
				};
			}

			throw error;
		}
	},
});

export const listCalendarEvents = action({
	args: {
		workspaceId: v.id("workspaces"),
		timeMax: v.string(),
		timeMin: v.string(),
	},
	returns: calendarEventsResponseValidator,
	handler: async (ctx, args): Promise<CalendarEventsResponse> => {
		const identity = await ctx.auth.getUserIdentity();

		if (!identity) {
			return {
				status: "not_connected",
				calendars: [],
				events: [],
			};
		}

		try {
			const requestedWindow = getCalendarViewWindow(args);
			const result = await fetchWorkspaceCalendarEvents({
				ctx,
				eventLimit: CALENDAR_EVENTS_LIMIT,
				minimumEndAt: requestedWindow.timeMin,
				requestedWindow,
				workspaceId: args.workspaceId,
			});

			if (result.connectedCalendarCount === 0) {
				return {
					status: "not_connected",
					calendars: [],
					events: [],
				};
			}

			return {
				status: "ready",
				calendars: result.calendars,
				events: sortCalendarEvents(result.events).slice(
					0,
					CALENDAR_EVENTS_LIMIT,
				),
			};
		} catch (error) {
			if (error instanceof Error && "status" in error && error.status === 401) {
				return {
					status: "not_connected",
					calendars: [],
					events: [],
				};
			}

			throw error;
		}
	},
});

const normalizeCalendarEventDetails = <Input extends CalendarEventDetailsInput>(
	input: Input,
): Input => {
	const title = input.title.trim();

	if (!title) {
		throw new ConvexError({
			code: "CALENDAR_EVENT_TITLE_REQUIRED",
			message: "Event title is required.",
		});
	}

	const guests = Array.from(
		new Set(input.guests.map((guest) => guest.trim().toLowerCase())),
	).filter(Boolean);

	if (guests.some((guest) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(guest))) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_EVENT_GUEST",
			message: "One or more guest email addresses are invalid.",
		});
	}

	if (input.time.kind === "all_day") {
		if (
			!/^\d{4}-\d{2}-\d{2}$/u.test(input.time.startDate) ||
			!/^\d{4}-\d{2}-\d{2}$/u.test(input.time.endDate) ||
			input.time.endDate <= input.time.startDate
		) {
			throw new ConvexError({
				code: "INVALID_CALENDAR_EVENT_TIME",
				message: "Event dates are invalid.",
			});
		}
	} else {
		const startAt = new Date(input.time.startAt).getTime();
		const endAt = new Date(input.time.endAt).getTime();

		if (
			!Number.isFinite(startAt) ||
			!Number.isFinite(endAt) ||
			endAt <= startAt
		) {
			throw new ConvexError({
				code: "INVALID_CALENDAR_EVENT_TIME",
				message: "Event time is invalid.",
			});
		}
	}

	return {
		...input,
		description: input.description?.trim() || undefined,
		guests,
		location: input.location?.trim() || undefined,
		title,
	};
};

const normalizeUpdateCalendarEventInput = (
	input: UpdateCalendarEventInput,
): UpdateCalendarEventInput => {
	const normalized = normalizeCalendarEventDetails({
		calendarId: input.calendarId,
		description: input.description,
		guests: [],
		location: input.location,
		time: input.time,
		title: input.title,
	});
	const providerEventId = input.providerEventId.trim();

	if (!providerEventId) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_EVENT_ID",
			message: "The calendar event identifier is invalid.",
		});
	}

	return {
		calendarId: normalized.calendarId,
		description: normalized.description,
		location: normalized.location,
		providerEventId,
		recurrenceId: input.recurrenceId,
		recurrenceIsAllDay: input.recurrenceIsAllDay,
		time: normalized.time,
		title: normalized.title,
	};
};

const normalizeCreateCalendarInput = ({
	color,
	name,
	provider,
}: {
	color: string;
	name: string;
	provider: "google" | "yandex";
}) => {
	const normalizedName = name.trim();
	const normalizedColor = color.trim().toLowerCase();

	if (!normalizedName || normalizedName.length > 128) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_NAME",
			message: "Calendar name must contain between 1 and 128 characters.",
		});
	}

	if (!/^#[0-9a-f]{6}$/u.test(normalizedColor)) {
		throw new ConvexError({
			code: "INVALID_CALENDAR_COLOR",
			message: "Calendar color is invalid.",
		});
	}

	return {
		color: normalizedColor,
		name: normalizedName,
		provider,
	};
};

export const createCalendar = action({
	args: {
		color: v.string(),
		name: v.string(),
		provider: calendarProviderValidator,
		workspaceId: v.id("workspaces"),
	},
	returns: v.object({ id: v.string() }),
	handler: async (ctx, args): Promise<{ id: string }> => {
		const identity = await ctx.auth.getUserIdentity();

		if (!identity) {
			throw new ConvexError({
				code: "UNAUTHENTICATED",
				message: "Sign in to create calendars.",
			});
		}

		const input = normalizeCreateCalendarInput(args);

		if (input.provider === "yandex") {
			const connection = await getYandexCalendarConnection({
				ctx,
				ownerTokenIdentifier: identity.tokenIdentifier,
				workspaceId: args.workspaceId,
			});

			if (!connection) {
				throw new ConvexError({
					code: "YANDEX_CALENDAR_NOT_CONNECTED",
					message: "Connect Yandex Calendar to create a calendar.",
				});
			}

			return await createYandexCalendar({
				color: input.color,
				connection,
				name: input.name,
			});
		}

		const authContext = await getGoogleAuthContext(ctx);
		return await createGoogleCalendar({
			authContext,
			color: input.color,
			name: input.name,
		});
	},
});

export const createCalendarEvent = action({
	args: {
		calendarId: v.string(),
		description: v.optional(v.string()),
		guests: v.array(v.string()),
		location: v.optional(v.string()),
		provider: calendarProviderValidator,
		time: calendarEventTimeValidator,
		title: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.object({ id: v.string() }),
	handler: async (ctx, args): Promise<{ id: string }> => {
		const identity = await ctx.auth.getUserIdentity();

		if (!identity) {
			throw new ConvexError({
				code: "UNAUTHENTICATED",
				message: "Sign in to create calendar events.",
			});
		}

		const input = normalizeCalendarEventDetails({
			calendarId: args.calendarId,
			description: args.description,
			guests: args.guests,
			location: args.location,
			provider: args.provider,
			time: args.time,
			title: args.title,
		});

		if (input.provider === "yandex") {
			const connection: YandexCalendarConnection | null =
				await getYandexCalendarConnection({
					ctx,
					ownerTokenIdentifier: identity.tokenIdentifier,
					workspaceId: args.workspaceId,
				});

			if (!connection) {
				throw new ConvexError({
					code: "YANDEX_CALENDAR_NOT_CONNECTED",
					message: "Connect Yandex Calendar to create this event.",
				});
			}

			return await createYandexCalendarEvent({
				connection,
				input,
			});
		}

		const authContext = await getGoogleAuthContext(ctx);
		return await createGoogleCalendarEvent({ authContext, input });
	},
});

export const updateCalendarEvent = action({
	args: {
		calendarId: v.string(),
		description: v.optional(v.string()),
		location: v.optional(v.string()),
		provider: calendarProviderValidator,
		providerEventId: v.string(),
		recurrenceId: v.optional(v.string()),
		recurrenceIsAllDay: v.optional(v.boolean()),
		time: calendarEventTimeValidator,
		title: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		const identity = await ctx.auth.getUserIdentity();

		if (!identity) {
			throw new ConvexError({
				code: "UNAUTHENTICATED",
				message: "Sign in to update calendar events.",
			});
		}

		const input = normalizeUpdateCalendarEventInput({
			calendarId: args.calendarId,
			description: args.description,
			location: args.location,
			providerEventId: args.providerEventId,
			recurrenceId: args.recurrenceId,
			recurrenceIsAllDay: args.recurrenceIsAllDay,
			time: args.time,
			title: args.title,
		});

		if (args.provider === "yandex") {
			const connection = await getYandexCalendarConnection({
				ctx,
				ownerTokenIdentifier: identity.tokenIdentifier,
				workspaceId: args.workspaceId,
			});

			if (!connection) {
				throw new ConvexError({
					code: "YANDEX_CALENDAR_NOT_CONNECTED",
					message: "Connect Yandex Calendar to update this event.",
				});
			}

			return await updateYandexCalendarEvent({ connection, input });
		}

		const authContext = await getGoogleAuthContext(ctx);
		return await updateGoogleCalendarEvent({ authContext, input });
	},
});

export const deleteCalendarEvent = action({
	args: {
		calendarId: v.string(),
		provider: calendarProviderValidator,
		providerEventId: v.string(),
		recurrenceId: v.optional(v.string()),
		recurrenceIsAllDay: v.optional(v.boolean()),
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		const identity = await ctx.auth.getUserIdentity();

		if (!identity) {
			throw new ConvexError({
				code: "UNAUTHENTICATED",
				message: "Sign in to delete calendar events.",
			});
		}

		const providerEventId = args.providerEventId.trim();

		if (!providerEventId) {
			throw new ConvexError({
				code: "INVALID_CALENDAR_EVENT_ID",
				message: "The calendar event identifier is invalid.",
			});
		}

		if (args.provider === "yandex") {
			const connection = await getYandexCalendarConnection({
				ctx,
				ownerTokenIdentifier: identity.tokenIdentifier,
				workspaceId: args.workspaceId,
			});

			if (!connection) {
				throw new ConvexError({
					code: "YANDEX_CALENDAR_NOT_CONNECTED",
					message: "Connect Yandex Calendar to delete this event.",
				});
			}

			return await deleteYandexCalendarEvent({
				calendarId: args.calendarId,
				connection,
				providerEventId,
				recurrenceId: args.recurrenceId,
				recurrenceIsAllDay: args.recurrenceIsAllDay,
			});
		}

		const authContext = await getGoogleAuthContext(ctx);
		return await deleteGoogleCalendarEvent({
			authContext,
			calendarId: args.calendarId,
			providerEventId,
		});
	},
});

const getCalendarToolWindow = () => {
	const now = Date.now();

	return {
		now,
		timeMin: now - CALENDAR_TOOL_LOOKBACK_MS,
		timeMax: now + CALENDAR_TOOL_LOOKAHEAD_MS,
	};
};

const buildCalendarToolSources = (events: UpcomingCalendarEvent[]) => {
	const seen = new Set<string>();

	return events.flatMap((event) => {
		if (!event.htmlLink || seen.has(event.htmlLink)) {
			return [];
		}

		seen.add(event.htmlLink);

		return [
			{
				type: "url" as const,
				url: event.htmlLink,
				title: event.title,
			},
		];
	});
};

const matchesCalendarSearchQuery = (
	event: UpcomingCalendarEvent,
	query: string,
) => {
	const normalizedQuery = query.trim().toLowerCase();

	if (!normalizedQuery) {
		return true;
	}

	return [
		event.title,
		event.calendarName,
		event.location ?? "",
		event.meetingUrl ?? "",
	]
		.join(" ")
		.toLowerCase()
		.includes(normalizedQuery);
};

const toCalendarToolResponse = ({
	connection,
	events,
	limit,
	meetingsOnly,
	query,
}: {
	connection: string;
	events: UpcomingCalendarEvent[];
	limit?: number;
	meetingsOnly?: boolean;
	query?: string;
}) => {
	const limitedEvents = sortCalendarEvents(
		events.filter((event) => {
			if (meetingsOnly && !event.isMeeting) {
				return false;
			}

			if (query && !matchesCalendarSearchQuery(event, query)) {
				return false;
			}

			return true;
		}),
	).slice(0, Math.max(1, Math.min(limit ?? CALENDAR_TOOL_EVENT_LIMIT, 25)));

	return {
		connection,
		events: limitedEvents,
		sources: buildCalendarToolSources(limitedEvents),
	};
};

const getGoogleCalendarToolResponse = async (
	ctx: ActionCtx,
	args: {
		limit?: number;
		meetingsOnly?: boolean;
		query?: string;
	},
) => {
	const authContext = await getGoogleAuthContext(ctx);
	const { now, timeMin, timeMax } = getCalendarToolWindow();
	const result = await fetchGoogleCalendarEvents({
		authContext,
		eventLimit: UPCOMING_EVENTS_LIMIT,
		minimumEndAt: now,
		timeMin: new Date(timeMin).toISOString(),
		timeMax: new Date(timeMax).toISOString(),
	});

	return toCalendarToolResponse({
		connection: "Google Calendar",
		events: dedupeUpcomingEvents(result.events),
		limit: args.limit,
		meetingsOnly: args.meetingsOnly,
		query: args.query,
	});
};

const getYandexCalendarToolResponse = async (
	ctx: ActionCtx,
	args: {
		workspaceId: Id<"workspaces">;
		limit?: number;
		meetingsOnly?: boolean;
		query?: string;
	},
) => {
	const { now, timeMin, timeMax } = getCalendarToolWindow();
	const result = await fetchYandexUpcomingEvents({
		ctx,
		now,
		timeMin,
		timeMax,
		workspaceId: args.workspaceId,
	});

	return toCalendarToolResponse({
		connection: "Yandex Calendar",
		events: dedupeUpcomingEvents(result.events),
		limit: args.limit,
		meetingsOnly: args.meetingsOnly,
		query: args.query,
	});
};

export const listGoogleCalendarEventsForTool = action({
	args: {
		limit: v.optional(v.number()),
		meetingsOnly: v.optional(v.boolean()),
	},
	returns: calendarToolResponseValidator,
	handler: async (ctx, args) => await getGoogleCalendarToolResponse(ctx, args),
});

export const searchGoogleCalendarEventsForTool = action({
	args: {
		query: v.string(),
		limit: v.optional(v.number()),
		meetingsOnly: v.optional(v.boolean()),
	},
	returns: calendarToolResponseValidator,
	handler: async (ctx, args) => await getGoogleCalendarToolResponse(ctx, args),
});

export const listYandexCalendarEventsForTool = action({
	args: {
		workspaceId: v.id("workspaces"),
		limit: v.optional(v.number()),
		meetingsOnly: v.optional(v.boolean()),
	},
	returns: calendarToolResponseValidator,
	handler: async (ctx, args) => await getYandexCalendarToolResponse(ctx, args),
});

export const searchYandexCalendarEventsForTool = action({
	args: {
		workspaceId: v.id("workspaces"),
		query: v.string(),
		limit: v.optional(v.number()),
		meetingsOnly: v.optional(v.boolean()),
	},
	returns: calendarToolResponseValidator,
	handler: async (ctx, args) => await getYandexCalendarToolResponse(ctx, args),
});
