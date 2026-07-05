import {
	buildRemoteMcpTools,
	validateRemoteMcpConnection,
} from "./remote-mcp-tools.mjs";

export { DEFAULT_FIGMA_MCP_ENDPOINT } from "./capability-metadata.mjs";

export const validateFigmaMcpConnection = async (connection) =>
	await validateRemoteMcpConnection({
		provider: "figma",
		displayName: "Figma",
		...connection,
	});

export const buildFigmaTools = async (connection) =>
	await buildRemoteMcpTools({
		...connection,
		toolPrefix: "figma",
	});
