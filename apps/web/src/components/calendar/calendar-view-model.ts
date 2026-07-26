import type { UpcomingCalendarEvent } from "@/app/app-types";

export const CALENDAR_COLOR_OPTIONS = [
	{
		label: "Blue",
		providerColor: "#3b82f6",
		value: "var(--color-blue-500)",
	},
	{
		label: "Violet",
		providerColor: "#8b5cf6",
		value: "var(--color-violet-500)",
	},
	{
		label: "Amber",
		providerColor: "#f59e0b",
		value: "var(--color-amber-500)",
	},
	{
		label: "Green",
		providerColor: "#10b981",
		value: "var(--color-emerald-500)",
	},
	{
		label: "Rose",
		providerColor: "#f43f5e",
		value: "var(--color-rose-500)",
	},
	{
		label: "Cyan",
		providerColor: "#06b6d4",
		value: "var(--color-cyan-500)",
	},
	{
		label: "Orange",
		providerColor: "#f97316",
		value: "var(--color-orange-500)",
	},
	{
		label: "Teal",
		providerColor: "#14b8a6",
		value: "var(--color-teal-500)",
	},
	{
		label: "Pink",
		providerColor: "#ec4899",
		value: "var(--color-pink-500)",
	},
	{
		label: "Indigo",
		providerColor: "#6366f1",
		value: "var(--color-indigo-500)",
	},
	{
		label: "Sky",
		providerColor: "#0ea5e9",
		value: "var(--color-sky-500)",
	},
] as const;

export type CalendarProvider = "google" | "yandex";

export type CalendarSource = {
	canCreateEvents: boolean;
	color: string;
	id: string;
	name: string;
	provider: CalendarProvider;
};

export type CalendarColor = (typeof CALENDAR_COLOR_OPTIONS)[number]["value"];
export type CalendarProviderColor =
	(typeof CALENDAR_COLOR_OPTIONS)[number]["providerColor"];

export type CalendarCreation = {
	color: CalendarProviderColor;
	name: string;
	provider: CalendarProvider;
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
