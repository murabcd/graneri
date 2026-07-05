import {
	buildRemoteMcpTools,
	validateRemoteMcpConnection,
} from "./remote-mcp-tools.mjs";

export { DEFAULT_ZOOM_MCP_ENDPOINT } from "./capability-metadata.mjs";

export const validateZoomMcpConnection = async (connection) =>
	await validateRemoteMcpConnection({
		provider: "zoom",
		displayName: "Zoom",
		includeOAuthClientIdHeader: true,
		...connection,
	});

export const buildZoomMcpTools = async (connection) =>
	await buildRemoteMcpTools({
		...connection,
		includeOAuthClientIdHeader: true,
	});
