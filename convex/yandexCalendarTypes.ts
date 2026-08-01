import type { UpcomingCalendarEvent } from "./calendarTypes";

export type ParsedIcsProperty = {
	parameters: Record<string, string>;
	value: string;
};

export type ParsedIcsEvent = {
	attendees: ParsedIcsProperty[];
	properties: Record<string, ParsedIcsProperty>;
};

export type YandexCalendarCollection = {
	color: string;
	displayName: string;
	href: string;
	id: string;
};

export type YandexCalendarConnection = {
	calendarHomePath: string;
	email: string;
	password: string;
	serverAddress: string;
};

export type YandexUpcomingCalendarEvent = UpcomingCalendarEvent & {
	provider: "yandex";
};
