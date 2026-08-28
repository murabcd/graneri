"use node";

import type { Infer } from "convex/values";
import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { action } from "./_generated/server";
import { scheduleCalendarPeopleSync } from "./calendarPeopleSync";
import {
	type CalendarToolProviderInput,
	createCalendarToolProviderAdapter,
	createWorkspaceCalendarProviderAdapters,
} from "./calendarProviderAdapters";
import { createCalendarProviderModule } from "./calendarProviderModule";
import { classifyCalendarReadError } from "./calendarReadError";
import { runCalendarToolQuery } from "./calendarToolQuery";
import type {
	CalendarEventsFetchResult,
	CalendarProvider,
	UpcomingCalendarEvent,
} from "./calendarTypes";
import {
	calendarEventRecurrenceInputValidator,
	calendarEventsResponseValidator,
	calendarEventTimeValidator,
	calendarProviderValidator,
	calendarToolResponseValidator,
	upcomingEventsResponseValidator,
} from "./calendarValidators";
import { createResourceAccess } from "./domain";

const UPCOMING_EVENTS_LIMIT = 12;
const CALENDAR_EVENTS_LIMIT = 250;
const CALENDAR_VIEW_MAX_WINDOW_MS = 62 * 24 * 60 * 60 * 1000;
const { requireIdentity: requireCalendarIdentity } =
	createResourceAccess("calendars");
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

const createWorkspaceCalendarProviderModule = ({
	ctx,
	ownerTokenIdentifier,
	workspaceId,
}: {
	ctx: ActionCtx;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
}) =>
	createCalendarProviderModule({
		adapters: createWorkspaceCalendarProviderAdapters({
			ctx,
			ownerTokenIdentifier,
			workspaceId,
		}),
	});

const createOwnedWorkspaceCalendarProviderModule = async ({
	ctx,
	workspaceId,
}: {
	ctx: ActionCtx;
	workspaceId: Id<"workspaces">;
}) => {
	const identity = await requireCalendarIdentity(ctx);
	await ctx.runQuery(internal.workspaces.assertAccess, {
		ownerTokenIdentifier: identity.tokenIdentifier,
		workspaceId,
	});

	return createWorkspaceCalendarProviderModule({
		ctx,
		ownerTokenIdentifier: identity.tokenIdentifier,
		workspaceId,
	});
};

const fetchWorkspaceCalendarEvents = async ({
	ctx,
	eventLimit,
	minimumEndAt,
	ownerTokenIdentifier,
	requestedWindow,
	workspaceId,
}: {
	ctx: ActionCtx;
	eventLimit: number;
	minimumEndAt: number;
	ownerTokenIdentifier: string;
	requestedWindow: RequestedCalendarWindow;
	workspaceId: Id<"workspaces">;
}): Promise<CalendarEventsFetchResult> => {
	const calendarVisibilityPreferences = await ctx.runQuery(
		api.calendarPreferences.get,
		{
			workspaceId,
		},
	);
	const providerModule = createWorkspaceCalendarProviderModule({
		ctx,
		ownerTokenIdentifier,
		workspaceId,
	});

	return await providerModule.listWorkspaceEvents({
		eventLimit,
		minimumEndAt,
		timeMax: requestedWindow.timeMax,
		timeMin: requestedWindow.timeMin,
		visibility: {
			google: calendarVisibilityPreferences.showGoogleCalendar,
			yandex: calendarVisibilityPreferences.showYandexCalendar,
		},
	});
};

export const listUpcomingCalendarEvents = action({
	args: {
		workspaceId: v.id("workspaces"),
		timeMax: v.string(),
		timeMin: v.string(),
	},
	returns: upcomingEventsResponseValidator,
	handler: async (
		ctx,
		args,
	): Promise<Infer<typeof upcomingEventsResponseValidator>> => {
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
				ownerTokenIdentifier: identity.tokenIdentifier,
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
			await scheduleCalendarPeopleSync({
				ctx,
				events,
				ownerTokenIdentifier: identity.tokenIdentifier,
				workspaceId: args.workspaceId,
			});

			return {
				status: "ready" as const,
				events,
				connectedCalendarCount: result.connectedCalendarCount,
			};
		} catch (error) {
			const errorStatus = classifyCalendarReadError(error);
			if (errorStatus === "not_connected") {
				return {
					status: "not_connected" as const,
					events: [],
				};
			}
			if (errorStatus === "unavailable") {
				return { status: "unavailable" as const };
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
	handler: async (
		ctx,
		args,
	): Promise<Infer<typeof calendarEventsResponseValidator>> => {
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
				ownerTokenIdentifier: identity.tokenIdentifier,
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
			await scheduleCalendarPeopleSync({
				ctx,
				events: result.events,
				ownerTokenIdentifier: identity.tokenIdentifier,
				workspaceId: args.workspaceId,
			});

			return {
				status: "ready",
				calendars: result.calendars,
				events: sortCalendarEvents(result.events).slice(
					0,
					CALENDAR_EVENTS_LIMIT,
				),
			};
		} catch (error) {
			const errorStatus = classifyCalendarReadError(error);
			if (errorStatus === "not_connected") {
				return {
					status: "not_connected",
					calendars: [],
					events: [],
				};
			}
			if (errorStatus === "unavailable") {
				return { status: "unavailable" };
			}

			throw error;
		}
	},
});

export const createCalendar = action({
	args: {
		color: v.string(),
		name: v.string(),
		provider: calendarProviderValidator,
		workspaceId: v.id("workspaces"),
	},
	returns: v.object({ id: v.string() }),
	handler: async (ctx, args): Promise<{ id: string }> => {
		const { workspaceId, ...command } = args;
		const providerModule = await createOwnedWorkspaceCalendarProviderModule({
			ctx,
			workspaceId,
		});
		return await providerModule.createCalendar(command);
	},
});

export const updateCalendar = action({
	args: {
		calendarId: v.string(),
		color: v.string(),
		name: v.string(),
		provider: calendarProviderValidator,
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		const { workspaceId, ...command } = args;
		const providerModule = await createOwnedWorkspaceCalendarProviderModule({
			ctx,
			workspaceId,
		});
		return await providerModule.updateCalendar(command);
	},
});

export const setDefaultCalendar = action({
	args: {
		calendarId: v.string(),
		provider: calendarProviderValidator,
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		const { workspaceId, ...command } = args;
		const providerModule = await createOwnedWorkspaceCalendarProviderModule({
			ctx,
			workspaceId,
		});
		return await providerModule.setDefaultCalendar(command);
	},
});

export const deleteCalendar = action({
	args: {
		calendarId: v.string(),
		destinationCalendarId: v.optional(v.string()),
		provider: calendarProviderValidator,
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		const { workspaceId, ...command } = args;
		const providerModule = await createOwnedWorkspaceCalendarProviderModule({
			ctx,
			workspaceId,
		});
		return await providerModule.removeCalendar(command);
	},
});

export const createCalendarEvent = action({
	args: {
		calendarId: v.string(),
		description: v.optional(v.string()),
		guests: v.array(v.string()),
		location: v.optional(v.string()),
		provider: calendarProviderValidator,
		recurrence: v.optional(calendarEventRecurrenceInputValidator),
		time: calendarEventTimeValidator,
		title: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.object({ id: v.string() }),
	handler: async (ctx, args): Promise<{ id: string }> => {
		const { workspaceId, ...command } = args;
		const providerModule = await createOwnedWorkspaceCalendarProviderModule({
			ctx,
			workspaceId,
		});
		return await providerModule.createEvent(command);
	},
});

export const updateCalendarEvent = action({
	args: {
		calendarId: v.string(),
		destinationCalendarId: v.string(),
		description: v.optional(v.string()),
		guests: v.array(v.string()),
		location: v.optional(v.string()),
		provider: calendarProviderValidator,
		providerEventId: v.string(),
		recurrenceId: v.optional(v.string()),
		recurrenceIsAllDay: v.optional(v.boolean()),
		seriesProviderEventId: v.optional(v.string()),
		time: calendarEventTimeValidator,
		title: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		const { workspaceId, ...command } = args;
		const providerModule = await createOwnedWorkspaceCalendarProviderModule({
			ctx,
			workspaceId,
		});
		return await providerModule.updateEvent(command);
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
		const { workspaceId, ...command } = args;
		const providerModule = await createOwnedWorkspaceCalendarProviderModule({
			ctx,
			workspaceId,
		});
		return await providerModule.deleteEvent(command);
	},
});

export const removeCalendarEvent = action({
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
		const { workspaceId, ...command } = args;
		const providerModule = await createOwnedWorkspaceCalendarProviderModule({
			ctx,
			workspaceId,
		});
		return await providerModule.removeEvent(command);
	},
});

const CALENDAR_PROVIDER_LABELS: Record<CalendarProvider, string> = {
	google: "Google Calendar",
	yandex: "Yandex Calendar",
};

export const getCalendarToolResponse = async ({
	ctx,
	limit,
	meetingsOnly,
	providerInput,
	query,
}: {
	ctx: ActionCtx;
	limit?: number;
	meetingsOnly?: boolean;
	providerInput: CalendarToolProviderInput;
	query?: string;
}) => {
	const providerAdapter = createCalendarToolProviderAdapter({
		ctx,
		input: providerInput,
	});

	return await runCalendarToolQuery({
		adapter: providerAdapter,
		connection: CALENDAR_PROVIDER_LABELS[providerInput.provider],
		limit,
		meetingsOnly,
		now: Date.now(),
		query,
	});
};

export const createCalendarCapabilityAdapter = ({
	ctx,
	providerInput,
}: {
	ctx: ActionCtx;
	providerInput: CalendarToolProviderInput;
}) => ({
	listEvents: async ({
		limit,
		meetingsOnly,
	}: {
		limit?: number;
		meetingsOnly?: boolean;
	}) =>
		await getCalendarToolResponse({
			ctx,
			limit,
			meetingsOnly,
			providerInput,
		}),
	searchEvents: async ({
		query,
		limit,
		meetingsOnly,
	}: {
		query: string;
		limit?: number;
		meetingsOnly?: boolean;
	}) =>
		await getCalendarToolResponse({
			ctx,
			query,
			limit,
			meetingsOnly,
			providerInput,
		}),
});

export const listGoogleCalendarEventsForTool = action({
	args: {
		limit: v.optional(v.number()),
		meetingsOnly: v.optional(v.boolean()),
	},
	returns: calendarToolResponseValidator,
	handler: async (ctx, args) =>
		await getCalendarToolResponse({
			ctx,
			providerInput: { provider: "google" },
			...args,
		}),
});

export const searchGoogleCalendarEventsForTool = action({
	args: {
		query: v.string(),
		limit: v.optional(v.number()),
		meetingsOnly: v.optional(v.boolean()),
	},
	returns: calendarToolResponseValidator,
	handler: async (ctx, args) =>
		await getCalendarToolResponse({
			ctx,
			providerInput: { provider: "google" },
			...args,
		}),
});

export const listYandexCalendarEventsForTool = action({
	args: {
		workspaceId: v.id("workspaces"),
		limit: v.optional(v.number()),
		meetingsOnly: v.optional(v.boolean()),
	},
	returns: calendarToolResponseValidator,
	handler: async (ctx, args) =>
		await getCalendarToolResponse({
			ctx,
			limit: args.limit,
			meetingsOnly: args.meetingsOnly,
			providerInput: {
				provider: "yandex",
				workspaceId: args.workspaceId,
			},
		}),
});

export const searchYandexCalendarEventsForTool = action({
	args: {
		workspaceId: v.id("workspaces"),
		query: v.string(),
		limit: v.optional(v.number()),
		meetingsOnly: v.optional(v.boolean()),
	},
	returns: calendarToolResponseValidator,
	handler: async (ctx, args) =>
		await getCalendarToolResponse({
			ctx,
			limit: args.limit,
			meetingsOnly: args.meetingsOnly,
			providerInput: {
				provider: "yandex",
				workspaceId: args.workspaceId,
			},
			query: args.query,
		}),
});
