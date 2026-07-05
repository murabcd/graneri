import {
	buildRemoteMcpTools,
	validateRemoteMcpConnection,
} from "./remote-mcp-tools.mjs";

export { DEFAULT_NOTION_MCP_ENDPOINT } from "./capability-metadata.mjs";

export const validateNotionMcpConnection = async (connection) =>
	await validateRemoteMcpConnection({
		provider: "notion",
		displayName: "Notion",
		...connection,
	});

export const buildNotionTools = async (connection) =>
	await buildRemoteMcpTools(connection);
