import {
	buildRemoteMcpTools,
	validateRemoteMcpConnection,
} from "./remote-mcp-tools.mjs";

export { DEFAULT_POSTHOG_MCP_ENDPOINT } from "./capability-metadata.mjs";

export const validatePostHogMcpConnection = async (connection) =>
	await validateRemoteMcpConnection({
		provider: "posthog",
		displayName: "PostHog",
		...connection,
	});

export const buildPostHogTools = async (connection) =>
	await buildRemoteMcpTools(connection);
