import { capabilityMetadataDefinitions } from "./capability-metadata.mjs";
import { buildContext7Tools } from "./context7-tools.mjs";
import { buildFigmaTools } from "./figma-tools.mjs";
import { buildGoogleCalendarTools } from "./google-calendar-tools.mjs";
import { buildGoogleDriveTools } from "./google-drive-tools.mjs";
import { buildJiraMcpTools } from "./jira-mcp-tools.mjs";
import { buildLinearTools } from "./linear-tools.mjs";
import { buildNotionTools } from "./notion-tools.mjs";
import { buildPostHogTools } from "./posthog-tools.mjs";
import { buildYandexCalendarTools } from "./yandex-calendar-tools.mjs";
import { buildYandexTrackerTools } from "./yandex-tracker-tools.mjs";
import { buildZoomMcpTools } from "./zoom-mcp-tools.mjs";

const buildRemoteMcpCapabilityTools =
	(toolPrefix, buildDirectTools) => async (connection, adapters) =>
		adapters.remoteMcp
			? await adapters.remoteMcp.buildTools({ connection, toolPrefix })
			: await buildDirectTools(connection);

const capabilityToolBuilders = {
	"google-calendar": async (_connection, adapters) =>
		adapters.googleCalendar
			? buildGoogleCalendarTools(adapters.googleCalendar)
			: {},
	"google-drive": async (_connection, adapters) =>
		adapters.googleDrive ? buildGoogleDriveTools(adapters.googleDrive) : {},
	context7: buildRemoteMcpCapabilityTools("context7", buildContext7Tools),
	figma: buildRemoteMcpCapabilityTools("figma", buildFigmaTools),
	"jira-mcp": buildRemoteMcpCapabilityTools("jira", buildJiraMcpTools),
	linear: buildRemoteMcpCapabilityTools("linear", buildLinearTools),
	notion: buildRemoteMcpCapabilityTools("notion", buildNotionTools),
	posthog: buildRemoteMcpCapabilityTools("posthog", buildPostHogTools),
	"yandex-calendar": async (_connection, adapters) =>
		adapters.yandexCalendar
			? buildYandexCalendarTools(adapters.yandexCalendar)
			: {},
	"yandex-tracker": async (connection, adapters) =>
		adapters.yandexTracker
			? adapters.yandexTracker.buildTools(connection)
			: buildYandexTrackerTools(connection),
	zoom: buildRemoteMcpCapabilityTools("zoom", buildZoomMcpTools),
};

export const graneriCapabilityRegistry = Object.fromEntries(
	capabilityMetadataDefinitions
		.filter((capability) => capability.sourceKind === "app")
		.map((capability) => {
			const buildTools = capabilityToolBuilders[capability.id];

			if (!buildTools) {
				throw new Error(
					`Missing tool adapter for capability: ${capability.id}`,
				);
			}

			return [capability.id, { ...capability, buildTools }];
		}),
);

export const getGraneriCapability = (provider) =>
	graneriCapabilityRegistry[provider] ?? null;

const withCapabilityNamespace = (tools, capability) =>
	Object.fromEntries(
		Object.entries(tools).map(([toolName, tool]) => [
			toolName,
			{
				...tool,
				providerOptions: {
					...(tool.providerOptions ?? {}),
					openai: {
						...(tool.providerOptions?.openai ?? {}),
						namespace: capability.toolNamespace,
					},
				},
			},
		]),
	);

export const buildCapabilityToolSet = async (connections, adapters = {}) => {
	const toolSets = await Promise.all(
		connections.map(async (connection) => {
			const capability = getGraneriCapability(connection.provider);

			if (!capability?.buildTools) {
				return {};
			}

			try {
				const tools = await capability.buildTools(connection, adapters);
				return withCapabilityNamespace(tools, capability);
			} catch (error) {
				console.error(
					`Connected capability ${connection.provider} could not load its tools.`,
					error,
				);
				return {};
			}
		}),
	);

	return Object.assign({}, ...toolSets);
};
