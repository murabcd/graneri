import type { UpcomingCalendarEvent } from "@/app/app-types";
import { APP_COLOR_PALETTE } from "@/lib/color-palette";

const CALENDAR_COLOR_NAMES = [
	"blue",
	"violet",
	"amber",
	"emerald",
	"rose",
	"cyan",
	"orange",
	"teal",
	"pink",
	"indigo",
	"sky",
] as const;

export const CALENDAR_COLOR_OPTIONS = CALENDAR_COLOR_NAMES.map((name) => ({
	label: APP_COLOR_PALETTE[name].label,
	providerColor: APP_COLOR_PALETTE[name].providerColor,
	value: APP_COLOR_PALETTE[name].cssValue,
}));

export type CalendarProvider = "google" | "yandex";
export type CalendarRemovalMode = "delete" | "none" | "unsubscribe";

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

export type CalendarColor = (typeof CALENDAR_COLOR_OPTIONS)[number]["value"];
export type CalendarProviderColor =
	(typeof CALENDAR_COLOR_OPTIONS)[number]["providerColor"];

export type CalendarCreation = {
	color: CalendarProviderColor;
	name: string;
	provider: CalendarProvider;
};

export type CalendarUpdate = {
	color: string;
	name: string;
};

export type CalendarRemoval = {
	destinationCalendarId?: string;
};

export type CalendarProviderOption = {
	id: CalendarProvider;
	name: string;
};

export type CalendarAgendaRange = {
	end: Date;
	start: Date;
};

export const filterCalendarEvents = (
	events: UpcomingCalendarEvent[],
	selectedCalendarIds: ReadonlySet<string>,
) => events.filter((event) => selectedCalendarIds.has(event.calendarId));

export const toCalendarRequestWindow = ({
	end,
	start,
}: CalendarAgendaRange) => ({
	timeMin: start.toISOString(),
	timeMax: end.toISOString(),
});

export const getCalendarAgendaRange = (date: Date): CalendarAgendaRange => {
	const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());

	const end = new Date(start);
	end.setDate(end.getDate() + 30);

	return { end, start };
};
