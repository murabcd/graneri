"use node";

import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import type {
	CalendarProviderAdapter,
	CalendarProviderAdapters,
	CalendarProviderReadInput,
} from "./calendarProviderModule";
import type {
	CalendarEventDetailsInput,
	CalendarEventsFetchResult,
	UpdateCalendarEventInput,
} from "./calendarTypes";
import { type GoogleAuthContext, getGoogleAuthContext } from "./googleAuth";
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
import type { YandexCalendarConnection } from "./yandexCalendarTypes";

type YandexWriteOperation =
	| "create_calendar"
	| "create_event"
	| "delete_event"
	| "update_event";

const YANDEX_CONNECTION_MESSAGES: Record<YandexWriteOperation, string> = {
	create_calendar: "Connect Yandex Calendar to create a calendar.",
	create_event: "Connect Yandex Calendar to create this event.",
	delete_event: "Connect Yandex Calendar to delete this event.",
	update_event: "Connect Yandex Calendar to update this event.",
};

const emptyCalendarResult = (): CalendarEventsFetchResult => ({
	calendars: [],
	connectedCalendarCount: 0,
	events: [],
});

export const createGoogleCalendarProviderAdapter = ({
	ctx,
}: {
	ctx: ActionCtx;
}): CalendarProviderAdapter => {
	let googleAuthContextPromise: Promise<GoogleAuthContext> | undefined;

	const getGoogleContext = () => {
		googleAuthContextPromise ??= getGoogleAuthContext(ctx);
		return googleAuthContextPromise;
	};

	const listGoogleEvents = async (input: CalendarProviderReadInput) =>
		await fetchGoogleCalendarEvents({
			authContext: await getGoogleContext(),
			eventLimit: input.eventLimit,
			minimumEndAt: input.minimumEndAt,
			timeMax: new Date(input.timeMax).toISOString(),
			timeMin: new Date(input.timeMin).toISOString(),
		});

	return {
		createCalendar: async (input) =>
			await createGoogleCalendar({
				authContext: await getGoogleContext(),
				...input,
			}),
		createEvent: async (input: CalendarEventDetailsInput) =>
			await createGoogleCalendarEvent({
				authContext: await getGoogleContext(),
				input,
			}),
		deleteEvent: async (input) =>
			await deleteGoogleCalendarEvent({
				authContext: await getGoogleContext(),
				calendarId: input.calendarId,
				providerEventId: input.providerEventId,
			}),
		listEvents: listGoogleEvents,
		updateEvent: async (input: UpdateCalendarEventInput) =>
			await updateGoogleCalendarEvent({
				authContext: await getGoogleContext(),
				input,
			}),
	};
};

export const createYandexCalendarProviderAdapter = ({
	ctx,
	ownerTokenIdentifier,
	workspaceId,
}: {
	ctx: ActionCtx;
	ownerTokenIdentifier?: string;
	workspaceId: Id<"workspaces">;
}): CalendarProviderAdapter => {
	let yandexConnectionPromise:
		| Promise<YandexCalendarConnection | null>
		| undefined;

	const getYandexConnection = () => {
		yandexConnectionPromise ??= (async () => {
			const resolvedOwnerTokenIdentifier =
				ownerTokenIdentifier ??
				(await ctx.auth.getUserIdentity())?.tokenIdentifier;

			if (!resolvedOwnerTokenIdentifier) {
				return null;
			}

			return await ctx.runQuery(
				internal.appConnections.getYandexCalendarCredentials,
				{
					ownerTokenIdentifier: resolvedOwnerTokenIdentifier,
					workspaceId,
				},
			);
		})();

		return yandexConnectionPromise;
	};

	const requireYandexConnection = async (
		operation: YandexWriteOperation,
	): Promise<YandexCalendarConnection> => {
		const connection = await getYandexConnection();

		if (!connection) {
			throw new ConvexError({
				code: "YANDEX_CALENDAR_NOT_CONNECTED",
				message: YANDEX_CONNECTION_MESSAGES[operation],
			});
		}

		return connection;
	};

	const listYandexEvents = async (input: CalendarProviderReadInput) => {
		const connection = await getYandexConnection();

		if (!connection) {
			return emptyCalendarResult();
		}

		return await listYandexUpcomingEvents({
			connection,
			now: input.minimumEndAt,
			timeMax: input.timeMax,
			timeMin: input.timeMin,
		});
	};

	return {
		createCalendar: async (input) =>
			await createYandexCalendar({
				connection: await requireYandexConnection("create_calendar"),
				...input,
			}),
		createEvent: async (input: CalendarEventDetailsInput) =>
			await createYandexCalendarEvent({
				connection: await requireYandexConnection("create_event"),
				input,
			}),
		deleteEvent: async (input) =>
			await deleteYandexCalendarEvent({
				connection: await requireYandexConnection("delete_event"),
				...input,
			}),
		listEvents: listYandexEvents,
		updateEvent: async (input: UpdateCalendarEventInput) =>
			await updateYandexCalendarEvent({
				connection: await requireYandexConnection("update_event"),
				input,
			}),
	};
};

export const createWorkspaceCalendarProviderAdapters = ({
	ctx,
	ownerTokenIdentifier,
	workspaceId,
}: {
	ctx: ActionCtx;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
}): CalendarProviderAdapters => ({
	google: createGoogleCalendarProviderAdapter({ ctx }),
	yandex: createYandexCalendarProviderAdapter({
		ctx,
		ownerTokenIdentifier,
		workspaceId,
	}),
});

export type CalendarToolProviderInput =
	| { provider: "google" }
	| { provider: "yandex"; workspaceId: Id<"workspaces"> };

export const createCalendarToolProviderAdapter = ({
	ctx,
	input,
}: {
	ctx: ActionCtx;
	input: CalendarToolProviderInput;
}) =>
	input.provider === "google"
		? createGoogleCalendarProviderAdapter({ ctx })
		: createYandexCalendarProviderAdapter({
				ctx,
				workspaceId: input.workspaceId,
			});
