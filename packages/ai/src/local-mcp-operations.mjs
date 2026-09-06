import { createHash } from "node:crypto";
import { z } from "zod";
import {
	localMcpCallOutputSchema,
	localMcpConfigurationSchema,
	localMcpDiscoverySchema,
} from "./local-mcp-contract.mjs";

const discoveryCursorSchema = z.strictObject({
	configurationHash: z.string(),
	serverName: z.string(),
	cursor: z.string().min(1).max(8192),
});

const loadConfiguration = async (workspace, rootIndex) => {
	const { root } = await workspace.resolveExistingPath({ rootIndex });
	let file;
	try {
		file = await workspace.readTextFile({
			rootIndex,
			relativePath: ".mcp.json",
			offsetBytes: 0,
			lengthBytes: 64_000,
		});
	} catch (error) {
		if (error.code === "ENOENT" && error.path !== root.path) return null;
		throw error;
	}
	if (file.truncated) throw new Error("Local MCP configuration exceeds 64 KB.");
	return {
		...localMcpConfigurationSchema.parse(JSON.parse(file.content)),
		hash: createHash("sha256")
			.update(root.path)
			.update("\0")
			.update(file.content)
			.digest("hex"),
	};
};
const prepareServer = async ({
	configuration,
	serverName,
	workspace,
	rootIndex,
}) => {
	const server =
		configuration && Object.hasOwn(configuration.mcpServers, serverName)
			? configuration.mcpServers[serverName]
			: null;
	if (!server)
		throw new Error(`Local MCP server "${serverName}" is not configured.`);
	const [relativePath, ...args] = server.args;
	const { root, path } = await workspace.resolveExistingPath({
		rootIndex,
		relativePath,
	});
	return {
		language: server.command === "python3" ? "python" : "javascript",
		args,
		scriptPath: path,
		rootPath: root.path,
	};
};
const boundedOutput = (output) => {
	if (Buffer.byteLength(JSON.stringify(output)) > 120_000)
		throw new Error(
			"Local MCP response exceeds 120 KB. Use a smaller page or have the server save its output to a file in the shared folder.",
		);
	return output;
};

export const listLocalMcpTools = async ({
	workspace,
	localMcp,
	rootIndex,
	serverName,
	cursor,
}) => {
	const configuration = await loadConfiguration(workspace, rootIndex);
	if (!serverName) {
		if (cursor)
			throw new Error("A server is required to continue MCP tool discovery.");
		return {
			kind: "servers",
			servers: Object.keys(configuration?.mcpServers ?? {}).sort(),
		};
	}
	const server = await prepareServer({
		configuration,
		serverName,
		workspace,
		rootIndex,
	});
	let providerCursor;
	if (cursor) {
		const position = discoveryCursorSchema.parse(
			JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
		);
		if (
			position.configurationHash !== configuration.hash ||
			position.serverName !== serverName
		)
			throw new Error("Local MCP discovery changed. Restart tool discovery.");
		providerCursor = position.cursor;
	}
	const result = await localMcp.listTools(server, providerCursor);
	return boundedOutput(
		localMcpDiscoverySchema.parse({
			kind: "tools",
			serverName,
			configurationHash: configuration.hash,
			tools: result.tools.map(({ name, description, inputSchema }) => ({
				name,
				description: description ?? "",
				inputSchema,
			})),
			nextCursor: result.nextCursor
				? Buffer.from(
						JSON.stringify(
							discoveryCursorSchema.parse({
								configurationHash: configuration.hash,
								serverName,
								cursor: result.nextCursor,
							}),
						),
					).toString("base64url")
				: null,
		}),
	);
};
export const callLocalMcpTool = async ({
	workspace,
	localMcp,
	rootIndex,
	serverName,
	configurationHash,
	toolName,
	arguments: args,
}) => {
	const configuration = await loadConfiguration(workspace, rootIndex);
	if (configuration?.hash !== configurationHash)
		throw new Error(
			"Local MCP configuration changed. Discover its tools again before calling them.",
		);
	const server = await prepareServer({
		configuration,
		serverName,
		workspace,
		rootIndex,
	});
	const result = await localMcp.callTool(server, toolName, args);
	return boundedOutput(
		localMcpCallOutputSchema.parse({ serverName, toolName, result }),
	);
};
