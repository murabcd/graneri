export const APP_SOURCE_PREFIX = "app:";
export const DEFAULT_CONTEXT7_MCP_ENDPOINT = "https://mcp.context7.com/mcp";
export const DEFAULT_FIGMA_MCP_ENDPOINT = "https://mcp.figma.com/mcp";
export const DEFAULT_JIRA_MCP_ENDPOINT = "https://mcp.atlassian.com/v1/mcp";
export const DEFAULT_LINEAR_MCP_ENDPOINT = "https://mcp.linear.app/mcp";
export const DEFAULT_NOTION_MCP_ENDPOINT = "https://mcp.notion.com/mcp";
export const DEFAULT_POSTHOG_MCP_ENDPOINT = "https://mcp.posthog.com/mcp";
export const DEFAULT_ZOOM_MCP_ENDPOINT =
	"https://mcp.zoom.us/mcp/zoom/streamable";
const GOOGLE_APP_SOURCE_IDS = new Set([
	"app:google-calendar",
	"app:google-drive",
]);

const getConnectionDisplayName = (connection, capability) =>
	connection.displayName ??
	connection.title ??
	capability?.displayName ??
	connection.provider;

const withDisplayName = (connection, capability, buildInstruction) =>
	buildInstruction(getConnectionDisplayName(connection, capability));

export const capabilityMetadataDefinitions = [
	{
		id: "google-calendar",
		displayName: "Google Calendar",
		sourceKind: "app",
		settingsGroup: "Productivity",
		sourceInstruction: () =>
			"The selected app source for this chat is Google Calendar. Treat it as the preferred source for meeting schedules, event timing, attendee context, and calendar availability.",
	},
	{
		id: "google-drive",
		displayName: "Google Drive",
		sourceKind: "app",
		settingsGroup: "Productivity",
		sourceInstruction: () =>
			"The selected app source for this chat is Google Drive. Treat it as the preferred source for connected Google docs, spreadsheets, presentations, and file metadata. Only read-only Drive tools are available in this chat.",
	},
	{
		id: "context7",
		displayName: "Context7",
		sourceKind: "app",
		connection: {
			usage: "chat",
			remoteMcpEndpoint: DEFAULT_CONTEXT7_MCP_ENDPOINT,
		},
		settingsGroup: "Knowledge",
		toolPrefix: "context7_",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is Context7 (${displayName}). Treat it as the preferred source for up-to-date library and API documentation. If the user's request needs current framework, SDK, package, or API docs, use the Context7 MCP tools before answering from memory.`,
			),
	},
	{
		id: "figma",
		displayName: "Figma",
		sourceKind: "app",
		connection: {
			usage: "chat",
			oauthFlow: "mcp-sdk",
			remoteMcpEndpoint: DEFAULT_FIGMA_MCP_ENDPOINT,
			requiresChatSourceToken: true,
		},
		settingsGroup: "Design",
		toolPrefix: "figma_",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is Figma (${displayName}). Treat it as the preferred source for design context, frames, components, variables, and design-to-code references. If the user provides a Figma URL or asks about a design, use the Figma MCP tools before answering from memory.`,
			),
	},
	{
		id: "jira-mcp",
		displayName: "Jira",
		sourceKind: "app",
		connection: {
			usage: "chat",
			oauthFlow: "mcp-sdk",
			remoteMcpEndpoint: DEFAULT_JIRA_MCP_ENDPOINT,
		},
		settingsGroup: "Tracking",
		toolPrefix: "jira_",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is Jira (${displayName}). Treat it as the preferred source for project history, tickets, tasks, comments, assignees, and status. If the user's request could be answered from Jira, use the Jira MCP tools before saying the context is unavailable.`,
			),
	},
	{
		id: "linear",
		displayName: "Linear",
		sourceKind: "app",
		connection: {
			usage: "chat",
			oauthFlow: "mcp-sdk",
			remoteMcpEndpoint: DEFAULT_LINEAR_MCP_ENDPOINT,
			requiresChatSourceToken: true,
		},
		settingsGroup: "Tracking",
		toolPrefix: "linear_",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is Linear (${displayName}). Treat it as the preferred source for issues, projects, cycles, teams, comments, assignees, and roadmap context. If the user's request could be answered from Linear, use the Linear MCP tools before saying the context is unavailable.`,
			),
	},
	{
		id: "notion",
		displayName: "Notion",
		sourceKind: "app",
		connection: {
			usage: "chat",
			oauthFlow: "mcp",
			remoteMcpEndpoint: DEFAULT_NOTION_MCP_ENDPOINT,
		},
		settingsGroup: "Knowledge",
		toolPrefix: "notion_",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is Notion (${displayName}). Treat it as the preferred source for workspace pages, specs, meeting notes, project docs, and databases. If the user's request could plausibly be answered from Notion, use the Notion tools before saying the context is unavailable. When the user provides a Notion URL or an exact Notion page or database reference, fetch it directly.`,
			),
	},
	{
		id: "posthog",
		displayName: "PostHog",
		sourceKind: "app",
		connection: {
			usage: "chat",
			oauthFlow: "mcp-sdk",
			remoteMcpEndpoint: DEFAULT_POSTHOG_MCP_ENDPOINT,
		},
		settingsGroup: "Analytics",
		toolPrefix: "posthog_",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is PostHog (${displayName}). Treat it as the preferred source for product analytics, saved insights, dashboards, feature flags, experiments, errors, event schema, surveys, and queryable product usage context. If the user's request could plausibly be answered from PostHog, use the PostHog MCP tools before saying the context is unavailable.`,
			),
	},
	{
		id: "yandex-calendar",
		displayName: "Yandex Calendar",
		sourceKind: "app",
		connection: { usage: "chat" },
		settingsGroup: "Productivity",
		sourceInstruction: () =>
			"The selected app source for this chat is Yandex Calendar. Treat it as the preferred source for meeting schedules, event timing, attendee context, and calendar availability.",
	},
	{
		id: "yandex-tracker",
		displayName: "Yandex Tracker",
		sourceKind: "app",
		connection: { usage: "chat" },
		settingsGroup: "Tracking",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is Yandex Tracker (${displayName}). Treat it as the preferred source for project history, integrations, tickets, tasks, comments, assignees, and status. If the user's request could be answered from Tracker, search Tracker first before saying the context is unavailable.`,
			),
	},
	{
		id: "zoom",
		displayName: "Zoom",
		sourceKind: "app",
		connection: {
			usage: "chat",
			oauthFlow: "mcp",
			remoteMcpEndpoint: DEFAULT_ZOOM_MCP_ENDPOINT,
		},
		settingsGroup: "Meetings",
		toolPrefix: "zoom_",
		sourceInstruction: (connection, capability) =>
			withDisplayName(
				connection,
				capability,
				(displayName) =>
					`The selected app source for this chat is Zoom (${displayName}). Treat it as the preferred source for meeting transcripts, recordings, summaries, and Zoom workspace context. If the user's request could plausibly be answered from Zoom, use the Zoom MCP tools before saying the context is unavailable.`,
			),
	},
	{
		id: "jira",
		displayName: "Jira",
		sourceKind: "sync",
		connection: { usage: "sync" },
		settingsGroup: "Tracking",
		settingsName: "Jira Sync",
	},
];

export const capabilityMetadataRegistry = Object.fromEntries(
	capabilityMetadataDefinitions.map((capability) => [
		capability.id,
		capability,
	]),
);

export const appSourceProviders = capabilityMetadataDefinitions
	.filter((capability) => capability.sourceKind === "app")
	.map((capability) => capability.id);

export const automationAppSourceProviders = appSourceProviders;

export const appSourceLabels = Object.fromEntries(
	capabilityMetadataDefinitions
		.filter((capability) => capability.sourceKind === "app")
		.map((capability) => [capability.id, capability.displayName]),
);

export const chatAppSourceProviders = capabilityMetadataDefinitions.map(
	(capability) => capability.id,
);

export const chatAppSourceLabels = Object.fromEntries(
	chatAppSourceProviders.map((provider) => [
		provider,
		capabilityMetadataRegistry[provider].displayName,
	]),
);

export const isChatAppSourceProvider = (value) =>
	typeof value === "string" && chatAppSourceProviders.includes(value);

export const getChatAppSourceLabel = (provider) =>
	chatAppSourceLabels[provider];

export const appConnectionProviders = capabilityMetadataDefinitions
	.filter((capability) => capability.connection)
	.map((capability) => capability.id);

export const mcpOAuthConnectionProviders = capabilityMetadataDefinitions
	.filter((capability) => capability.connection?.oauthFlow)
	.map((capability) => capability.id);

export const mcpSdkOAuthConnectionProviders = capabilityMetadataDefinitions
	.filter((capability) => capability.connection?.oauthFlow === "mcp-sdk")
	.map((capability) => capability.id);

export const isMcpSdkOAuthConnectionProvider = (provider) =>
	typeof provider === "string" &&
	mcpSdkOAuthConnectionProviders.includes(provider);

export const chatSourceAppConnectionProviders = capabilityMetadataDefinitions
	.filter((capability) => capability.connection?.usage === "chat")
	.map((capability) => capability.id);

export const tokenRequiredChatSourceAppConnectionProviders =
	capabilityMetadataDefinitions
		.filter((capability) => capability.connection?.requiresChatSourceToken)
		.map((capability) => capability.id);

export const appConnectionProviderLabels = Object.fromEntries(
	appConnectionProviders.map((provider) => [
		provider,
		capabilityMetadataRegistry[provider].displayName,
	]),
);

export const remoteMcpConnectionDefaults = Object.fromEntries(
	capabilityMetadataDefinitions
		.filter((capability) => capability.connection?.remoteMcpEndpoint)
		.map((capability) => [
			capability.id,
			{
				displayName: capability.displayName,
				endpoint: capability.connection.remoteMcpEndpoint,
			},
		]),
);

export const remoteMcpToolPrefixes = capabilityMetadataDefinitions
	.filter((capability) => capability.toolPrefix)
	.map((capability) => ({
		prefix: capability.toolPrefix,
		provider: capability.id,
		label: capability.displayName,
	}));

export const getCapabilityMetadata = (provider) =>
	capabilityMetadataRegistry[provider] ?? null;

export const getCapabilitySettings = (provider) => {
	const capability = getCapabilityMetadata(provider);

	if (!capability) {
		throw new Error(`Unknown connected capability: ${provider}`);
	}

	return {
		group: capability.settingsGroup,
		name: capability.settingsName ?? capability.displayName,
	};
};

export const getSelectedAppSourceIds = (selectedSourceIds) =>
	(selectedSourceIds ?? []).filter((value) =>
		value.startsWith(APP_SOURCE_PREFIX),
	);

export const getSelectedNoteSourceIds = ({ mentions }) =>
	Array.from(new Set(mentions ?? [])).filter(Boolean);

export const loadSelectedAppSourceConnections = async ({
	getAppConnections,
	listGoogleSources,
	selectedSourceIds,
}) => {
	const allSelectedSourceIds = selectedSourceIds ?? [];

	if (allSelectedSourceIds.length === 0) {
		return [];
	}

	const sourceIds = getSelectedAppSourceIds(selectedSourceIds);
	const appConnectionSourceIds = sourceIds.filter(
		(sourceId) => !GOOGLE_APP_SOURCE_IDS.has(sourceId),
	);
	const googleSources = listGoogleSources ? await listGoogleSources() : [];
	const selectedGoogleSources = googleSources.filter((source) =>
		allSelectedSourceIds.includes(source.id),
	);

	if (appConnectionSourceIds.length === 0 || !getAppConnections) {
		return selectedGoogleSources;
	}

	const appConnections = await getAppConnections(appConnectionSourceIds);

	return [...appConnections, ...selectedGoogleSources];
};

export const buildSelectedAppSourceInstructions = (connections) =>
	connections
		.map((connection) => {
			const capability = getCapabilityMetadata(connection.provider);
			return capability?.sourceInstruction
				? capability.sourceInstruction(connection, capability)
				: "";
		})
		.filter(Boolean)
		.join("\n\n");
