import { z } from "zod";
import { buildAiToolSet, defineAiTool } from "./ai-tool-definition.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

export const buildYandexCalendarToolDefinitions = ({
	listEvents,
	searchEvents,
}) => [
	defineAiTool({
		name: "yandex_calendar_list_events",
		description:
			"List upcoming Yandex Calendar events from the connected Yandex account. Use this for schedules, upcoming meetings, and calendar context.",
		inputSchema: z.object({
			limit: z.number().int().min(1).max(25).optional(),
			meetingsOnly: z.boolean().optional(),
		}),
		policy: {
			access: "read",
			capability: "read",
			provider: "yandex-calendar",
			requiresConnection: true,
		},
		ui: toolUiMetadata.yandex_calendar_list_events,
		execute: async ({ limit, meetingsOnly }) =>
			await listEvents({ limit, meetingsOnly }),
	}),
	defineAiTool({
		name: "yandex_calendar_search_events",
		description:
			"Search current and upcoming Yandex Calendar events by title, description, calendar name, location, meeting URL, attendee name, or attendee email. Use this when the user asks which meetings are scheduled with a specific person or company.",
		inputSchema: z.object({
			query: z.string().min(1),
			limit: z.number().int().min(1).max(25).optional(),
			meetingsOnly: z.boolean().optional(),
		}),
		policy: {
			access: "read",
			capability: "search",
			provider: "yandex-calendar",
			requiresConnection: true,
		},
		ui: toolUiMetadata.yandex_calendar_search_events,
		execute: async ({ query, limit, meetingsOnly }) =>
			await searchEvents({ query, limit, meetingsOnly }),
	}),
];

export const buildYandexCalendarTools = (args) =>
	buildAiToolSet(buildYandexCalendarToolDefinitions(args));
