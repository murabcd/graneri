import { api } from "../../../convex/_generated/api.js";
import { buildMeetingTools } from "./meeting-tools.mjs";
import { buildRemoteMcpProxyTools } from "./remote-mcp-tools.mjs";
import {
	buildWorkspaceToolCatalog,
	getWorkspaceToolConnectionDisplayName,
	getWorkspaceToolConnectionId,
} from "./workspace-tool-catalog.mjs";
import { buildYandexTrackerProxyTools } from "./yandex-tracker-tools.mjs";

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
							...(from && { from }),
							...(to && { to }),
							...(typeof limit === "number" && { limit }),
						},
					),
			})
		: {};
	const adapters = {
		...(hasConnection(connections, "google-calendar") &&
			convexClient &&
			canUseWorkspaceTools && {
				googleCalendar: {
					listEvents: async ({ limit, meetingsOnly }) =>
						await convexClient.action(
							api.calendar.listGoogleCalendarEventsForTool,
							{
								...(typeof limit === "number" && { limit }),
								...(typeof meetingsOnly === "boolean" && { meetingsOnly }),
							},
						),
					searchEvents: async ({ query, limit, meetingsOnly }) =>
						await convexClient.action(
							api.calendar.searchGoogleCalendarEventsForTool,
							{
								query: query ?? "",
								...(typeof limit === "number" && { limit }),
								...(typeof meetingsOnly === "boolean" && { meetingsOnly }),
							},
						),
				},
			}),
		...(hasConnection(connections, "google-drive") &&
			convexClient && {
				googleDrive: {
					searchFiles: async ({ query, limit }) =>
						await convexClient.action(
							api.googleTools.searchGoogleDriveFilesForTool,
							{
								query,
								...(typeof limit === "number" && { limit }),
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
			}),
		...(hasConnection(connections, "yandex-calendar") &&
			convexClient &&
			canUseWorkspaceTools && {
				yandexCalendar: {
					listEvents: async ({ limit, meetingsOnly }) =>
						await convexClient.action(
							api.calendar.listYandexCalendarEventsForTool,
							{
								workspaceId,
								...(typeof limit === "number" && { limit }),
								...(typeof meetingsOnly === "boolean" && { meetingsOnly }),
							},
						),
					searchEvents: async ({ query, limit, meetingsOnly }) =>
						await convexClient.action(
							api.calendar.searchYandexCalendarEventsForTool,
							{
								workspaceId,
								query,
								...(typeof limit === "number" && { limit }),
								...(typeof meetingsOnly === "boolean" && { meetingsOnly }),
							},
						),
				},
			}),
		...(convexClient &&
			canUseWorkspaceTools && {
				remoteMcp: {
					buildTools: async ({ connection, toolPrefix }) => {
						const sourceId = getWorkspaceToolConnectionId(connection);
						return await buildRemoteMcpProxyTools(
							{
								sourceId,
								provider: connection.provider,
								displayName: getWorkspaceToolConnectionDisplayName(connection),
								toolPrefix,
							},
							{
								listTools: async () =>
									await convexClient.action(
										api.connectedAppTools.listRemoteMcpTools,
										{ workspaceId, sourceId },
									),
								executeTool: async ({ inputJson, toolName }) =>
									await convexClient.action(
										api.connectedAppTools.executeRemoteMcpTool,
										{
											workspaceId,
											sourceId,
											inputJson,
											toolName,
										},
									),
							},
						);
					},
				},
				yandexTracker: {
					buildTools: (connection) => {
						const sourceId = getWorkspaceToolConnectionId(connection);
						return buildYandexTrackerProxyTools({
							searchIssues: async ({ query, limit }) =>
								await convexClient.action(
									api.connectedAppTools.searchYandexTrackerIssuesForTool,
									{ workspaceId, sourceId, query, limit },
								),
							getIssue: async ({ issueKey }) =>
								await convexClient.action(
									api.connectedAppTools.getYandexTrackerIssueForTool,
									{ workspaceId, sourceId, issueKey },
								),
						});
					},
				},
			}),
	};

	return await buildWorkspaceToolCatalog({
		adapters,
		connections,
		meetingTools,
		scope,
		selectedSourceIds,
	});
};
