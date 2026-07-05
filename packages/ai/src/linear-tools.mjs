import {
	buildRemoteMcpTools,
	validateRemoteMcpConnection,
} from "./remote-mcp-tools.mjs";

export { DEFAULT_LINEAR_MCP_ENDPOINT } from "./capability-metadata.mjs";

export const validateLinearMcpConnection = async (connection) =>
	await validateRemoteMcpConnection({
		provider: "linear",
		displayName: "Linear",
		...connection,
	});

export const buildLinearTools = async (connection) =>
	await buildRemoteMcpTools({
		...connection,
		toolPrefix: "linear",
	});
