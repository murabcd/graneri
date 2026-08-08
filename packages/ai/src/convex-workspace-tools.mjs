import { api } from "../../../convex/_generated/api.js";
import { buildMeetingTools } from "./meeting-tools.mjs";
import { buildWorkspaceToolCatalog } from "./workspace-tool-catalog.mjs";

const hasConnection = (connections, provider) =>
	connections.some((connection) => connection.provider === provider);

export const buildConvexWorkspaceToolSet = async ({
	connections,
	convexClient,
	scope = "available",
	selectedSourceIds = [],
	workspaceId,
}) => {
	const canUseWorkspaceTools = Boolean(convexClient && workspaceId);

	const meetingTools = canUseWorkspaceTools
		? buildMeetingTools({
				searchMeetings: async ({ query, from, to, limit }) =>
					await convexClient.query(
						api.meetingRelationships.searchMeetingNotes,
						{
							workspaceId,
							query,
							...(from ? { from } : {}),
							...(to ? { to } : {}),
							...(typeof limit === "number" ? { limit } : {}),
						},
					),
			})
		: {};
	const adapters = {
		...(hasConnection(connections, "google-calendar") &&
		convexClient &&
		canUseWorkspaceTools
			? {
					googleCalendar: {
						listEvents: async ({ limit, meetingsOnly }) =>
							await convexClient.action(
								api.calendar.listGoogleCalendarEventsForTool,
								{
									...(typeof limit === "number" ? { limit } : {}),
									...(typeof meetingsOnly === "boolean"
										? { meetingsOnly }
										: {}),
								},
							),
						searchEvents: async ({ query, limit, meetingsOnly }) =>
							await convexClient.action(
								api.calendar.searchGoogleCalendarEventsForTool,
								{
									query: query ?? "",
									...(typeof limit === "number" ? { limit } : {}),
									...(typeof meetingsOnly === "boolean"
										? { meetingsOnly }
										: {}),
								},
							),
					},
				}
			: {}),
		...(hasConnection(connections, "google-drive") && convexClient
			? {
					googleDrive: {
						searchFiles: async ({ query, limit }) =>
							await convexClient.action(
								api.googleTools.searchGoogleDriveFilesForTool,
								{
									query,
									...(typeof limit === "number" ? { limit } : {}),
								},
							),
						getFile: async ({ fileId }) =>
							await convexClient.action(
								api.googleTools.getGoogleDriveFileForTool,
								{
									fileId,
								},
							),
					},
				}
			: {}),
		...(hasConnection(connections, "yandex-calendar") &&
		convexClient &&
		canUseWorkspaceTools
			? {
					yandexCalendar: {
						listEvents: async ({ limit, meetingsOnly }) =>
							await convexClient.action(
								api.calendar.listYandexCalendarEventsForTool,
								{
									workspaceId,
									...(typeof limit === "number" ? { limit } : {}),
									...(typeof meetingsOnly === "boolean"
										? { meetingsOnly }
										: {}),
								},
							),
						searchEvents: async ({ query, limit, meetingsOnly }) =>
							await convexClient.action(
								api.calendar.searchYandexCalendarEventsForTool,
								{
									workspaceId,
									query,
									...(typeof limit === "number" ? { limit } : {}),
									...(typeof meetingsOnly === "boolean"
										? { meetingsOnly }
										: {}),
								},
							),
					},
				}
			: {}),
	};

	return await buildWorkspaceToolCatalog({
		adapters,
		connections,
		meetingTools,
		scope,
		selectedSourceIds,
	});
};
