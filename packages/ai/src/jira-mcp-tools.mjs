import {
	buildRemoteMcpTools,
	validateRemoteMcpConnection,
} from "./remote-mcp-tools.mjs";

export { DEFAULT_JIRA_MCP_ENDPOINT } from "./capability-metadata.mjs";

export const validateJiraMcpConnection = async (connection) =>
	await validateRemoteMcpConnection({
		provider: "jira-mcp",
		toolPrefix: "jira",
		displayName: "Jira",
		...connection,
	});

export const buildJiraMcpTools = async (connection) =>
	await buildRemoteMcpTools({
		...connection,
		toolPrefix: "jira",
	});
