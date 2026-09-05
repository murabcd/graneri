import { createMCPClient } from "@ai-sdk/mcp";
import { dynamicTool, jsonSchema } from "ai";
import { z } from "zod";
import {
	classifyRemoteMcpToolPolicy,
	createAiToolMetadata,
} from "./ai-tool-authority.mjs";

const REMOTE_MCP_DISCOVERY_TIMEOUT_MS = 5_000;
const REMOTE_MCP_DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;
const REMOTE_MCP_DISCOVERY_CACHE_LIMIT = 100;
const REMOTE_MCP_TOOL_LIMIT = 256;
const REMOTE_MCP_INVENTORY_CHARACTER_LIMIT = 2_000_000;
const remoteMcpDiscoveryCache = new Map();
const remoteMcpDiscoveryPromises = new Map();

const remoteMcpToolDefinitionSchema = z
	.object({
		name: z.string().min(1),
		title: z.string().optional(),
		description: z.string().trim().min(1),
		inputSchema: z
			.object({
				properties: z.record(z.string(), z.json()).optional(),
			})
			.catchall(z.json()),
		annotations: z
			.object({
				readOnlyHint: z.boolean().optional(),
				title: z.string().optional(),
			})
			.catchall(z.json())
			.optional(),
	})
	.catchall(z.json());

const remoteMcpDefinitionsSchema = z
	.object({
		tools: z.array(remoteMcpToolDefinitionSchema).max(REMOTE_MCP_TOOL_LIMIT),
	})
	.catchall(z.json());
const remoteMcpToolArgumentsSchema = z.record(z.string(), z.json());
const remoteMcpToolResultSchema = z.json();

const withRemoteMcpClient = async (connection, callback, abortSignal) => {
	abortSignal?.throwIfAborted();
	const headers = {};

	for (const [key, value] of Object.entries(connection.env ?? {})) {
		if (key && value) {
			headers[key] = value;
		}
	}

	if (connection.oauthAccessToken) {
		headers.Authorization = `Bearer ${connection.oauthAccessToken}`;
	}

	if (connection.includeOAuthClientIdHeader && connection.oauthClientId) {
		headers["X-Client-ID"] = connection.oauthClientId;
	}

	const client = await createMCPClient({
		transport: {
			type: "http",
			url: connection.baseUrl,
			...(Object.keys(headers).length > 0 && { headers }),
			redirect: "error",
			fetch: (url, init) =>
				fetch(url, {
					...init,
					signal: abortSignal
						? AbortSignal.any([
								abortSignal,
								...(init?.signal ? [init.signal] : []),
							])
						: init?.signal,
				}),
		},
		clientName: "graneri",
		version: "0.0.1",
	});

	try {
		return await callback(client);
	} finally {
		await client.close();
	}
};

const normalizeToolName = (provider, toolName) =>
	`${provider}_${toolName
		.trim()
		.replace(/[^a-zA-Z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "")}`;

const makeUniqueToolName = (provider, toolName, tools) => {
	const normalizedName = normalizeToolName(provider, toolName);
	const baseName = normalizedName || `${provider}_tool`;
	let candidateName = baseName;
	let suffix = 2;

	while (candidateName in tools) {
		candidateName = `${baseName}_${suffix}`;
		suffix += 1;
	}

	return candidateName;
};

const REMOTE_MCP_SUBTITLE_KEYS = [
	"query",
	"question",
	"q",
	"search",
	"jql",
	"issueKey",
	"key",
	"url",
	"id",
	"name",
	"title",
];

const getRemoteMcpToolUiMetadata = (connection) => ({
	groupKey: `mcp:${connection.provider}`,
	groupLabel: connection.displayName,
	icon: "database",
	running: `Using ${connection.displayName}`,
	complete: `Used ${connection.displayName}`,
	subtitleKeys: REMOTE_MCP_SUBTITLE_KEYS,
});

const remoteMcpToolOutputForModel = ({ output }) => {
	if (!Array.isArray(output?.content)) {
		return { type: "json", value: output };
	}

	return {
		type: "content",
		value: output.content.map((part) => {
			if (part?.type === "text" && typeof part.text === "string") {
				return { type: "text", text: part.text };
			}
			if (
				part?.type === "image" &&
				typeof part.data === "string" &&
				typeof part.mimeType === "string"
			) {
				return {
					type: "file",
					mediaType: part.mimeType,
					data: { type: "data", data: part.data },
				};
			}

			return { type: "text", text: JSON.stringify(part) };
		}),
	};
};

const executeRemoteMcpTool = async (connection, definition, args, options) =>
	await withRemoteMcpClient(
		connection,
		async (client) => {
			const tools = client.toolsFromDefinitions({ tools: [definition] });
			const tool = tools[definition.name];

			if (!tool?.execute) {
				throw new Error(
					`${connection.displayName} MCP tool "${definition.name}" is unavailable.`,
				);
			}

			return await tool.execute(args, options);
		},
		options?.abortSignal,
	);

const getRemoteMcpDiscoveryCacheKey = (connection) =>
	connection.sourceId
		? `${connection.provider}:${connection.sourceId}:${connection.baseUrl}`
		: null;

const readCachedRemoteMcpDefinitions = (connection) => {
	const cacheKey = getRemoteMcpDiscoveryCacheKey(connection);
	if (!cacheKey) {
		return null;
	}

	const cached = remoteMcpDiscoveryCache.get(cacheKey);
	if (!cached || cached.expiresAt <= Date.now()) {
		remoteMcpDiscoveryCache.delete(cacheKey);
		return null;
	}

	remoteMcpDiscoveryCache.delete(cacheKey);
	remoteMcpDiscoveryCache.set(cacheKey, cached);
	return cached.definitions;
};

const cacheRemoteMcpDefinitions = (connection, definitions) => {
	const cacheKey = getRemoteMcpDiscoveryCacheKey(connection);
	if (!cacheKey) {
		return;
	}

	remoteMcpDiscoveryCache.delete(cacheKey);
	remoteMcpDiscoveryCache.set(cacheKey, {
		definitions,
		expiresAt: Date.now() + REMOTE_MCP_DISCOVERY_CACHE_TTL_MS,
	});

	while (remoteMcpDiscoveryCache.size > REMOTE_MCP_DISCOVERY_CACHE_LIMIT) {
		const oldestCacheKey = remoteMcpDiscoveryCache.keys().next().value;
		if (!oldestCacheKey) {
			break;
		}
		remoteMcpDiscoveryCache.delete(oldestCacheKey);
	}
};

const validateRemoteMcpDefinitions = (connection, definitions) => {
	const serializedDefinitions = JSON.stringify(definitions);
	if (typeof serializedDefinitions !== "string") {
		throw new Error(
			`${connection.displayName} returned an invalid MCP tool inventory.`,
		);
	}
	if (serializedDefinitions.length > REMOTE_MCP_INVENTORY_CHARACTER_LIMIT) {
		throw new Error(
			`${connection.displayName} returned an oversized MCP tool inventory.`,
		);
	}

	const result = remoteMcpDefinitionsSchema.safeParse(definitions);
	if (!result.success) {
		const limitIssue = result.error.issues.find(
			(issue) => issue.code === "too_big" && issue.path[0] === "tools",
		);
		throw new Error(
			limitIssue
				? `${connection.displayName} exposes more than ${REMOTE_MCP_TOOL_LIMIT} MCP tools.`
				: `${connection.displayName} returned an invalid MCP tool inventory.`,
		);
	}

	return result.data;
};

const listRemoteMcpDefinitions = async (connection, client, signal) => {
	const tools = [];
	const cursors = new Set();
	const names = new Set();
	let cursor;
	for (;;) {
		const page = await client.listTools({
			...(cursor && { params: { cursor } }),
			options: { signal },
		});
		const inventory = validateRemoteMcpDefinitions(connection, {
			tools: [...tools, ...page.tools],
		});
		for (const tool of page.tools) {
			if (names.has(tool.name)) {
				throw new Error(
					`${connection.displayName} returned duplicate MCP tool names.`,
				);
			}
			names.add(tool.name);
		}
		tools.push(...inventory.tools.slice(tools.length));
		if (!page.nextCursor) return { tools };
		if (cursors.has(page.nextCursor) || cursors.size >= REMOTE_MCP_TOOL_LIMIT) {
			throw new Error(
				`${connection.displayName} returned invalid MCP pagination.`,
			);
		}
		cursors.add(page.nextCursor);
		cursor = page.nextCursor;
	}
};

const loadRemoteMcpDefinitions = async (connection) => {
	const controller = new AbortController();
	const timer = setTimeout(
		() =>
			controller.abort(
				new Error(`${connection.displayName} MCP discovery timed out.`),
			),
		REMOTE_MCP_DISCOVERY_TIMEOUT_MS,
	);
	try {
		return await withRemoteMcpClient(
			connection,
			async (client) =>
				await listRemoteMcpDefinitions(connection, client, controller.signal),
			controller.signal,
		);
	} finally {
		clearTimeout(timer);
	}
};

const parseRemoteMcpJson = (value, schema, errorMessage) => {
	let parsed;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error(errorMessage);
	}

	const result = schema.safeParse(parsed);
	if (!result.success) {
		throw new Error(errorMessage);
	}

	return result.data;
};

const serializeRemoteMcpJson = (value, errorMessage) => {
	const serialized = JSON.stringify(value);
	if (typeof serialized !== "string") {
		throw new Error(errorMessage);
	}
	return serialized;
};

const discoverRemoteMcpDefinitions = async (connection) => {
	const cached = readCachedRemoteMcpDefinitions(connection);
	if (cached) {
		return cached;
	}

	const cacheKey = getRemoteMcpDiscoveryCacheKey(connection);
	const pendingDiscovery = cacheKey
		? remoteMcpDiscoveryPromises.get(cacheKey)
		: null;
	if (pendingDiscovery) {
		return await pendingDiscovery;
	}

	const discovery = loadRemoteMcpDefinitions(connection).then((definitions) => {
		cacheRemoteMcpDefinitions(connection, definitions);
		return definitions;
	});
	if (cacheKey) {
		remoteMcpDiscoveryPromises.set(cacheKey, discovery);
	}

	try {
		return await discovery;
	} finally {
		if (cacheKey && remoteMcpDiscoveryPromises.get(cacheKey) === discovery) {
			remoteMcpDiscoveryPromises.delete(cacheKey);
		}
	}
};

export const validateRemoteMcpConnection = async (connection) =>
	(await loadRemoteMcpDefinitions(connection)).tools;

const buildRemoteMcpToolsFromDefinitions = (
	connection,
	definitions,
	executeTool,
) => {
	const tools = {};

	for (const definition of definitions.tools) {
		const toolName = makeUniqueToolName(
			connection.toolPrefix ?? connection.provider,
			definition.name,
			tools,
		);
		const title = definition.title ?? definition.annotations?.title;

		tools[toolName] = dynamicTool({
			description: definition.description,
			...(title && { title }),
			inputSchema: jsonSchema({
				...definition.inputSchema,
				properties: definition.inputSchema.properties ?? {},
				additionalProperties: false,
			}),
			metadata: {
				...createAiToolMetadata({
					policy: classifyRemoteMcpToolPolicy({
						annotations: definition.annotations,
						provider: connection.provider,
					}),
					ui: getRemoteMcpToolUiMetadata(connection),
				}),
				provider: connection.provider,
				source: "mcp",
				mcpToolName: definition.name,
			},
			providerOptions: {
				openai: {
					deferLoading: true,
				},
			},
			execute: async (args, options) =>
				await executeTool(definition, args, options),
			toModelOutput: remoteMcpToolOutputForModel,
		});
	}

	return tools;
};

export const buildRemoteMcpTools = async (connection) =>
	buildRemoteMcpToolsFromDefinitions(
		connection,
		await discoverRemoteMcpDefinitions(connection),
		async (definition, args, options) =>
			await executeRemoteMcpTool(connection, definition, args, options),
	);

export const listRemoteMcpToolsForProxy = async (connection) =>
	serializeRemoteMcpJson(
		await discoverRemoteMcpDefinitions(connection),
		`${connection.displayName} tool inventory could not be serialized.`,
	);

export const executeRemoteMcpToolForProxy = async (
	connection,
	{ inputJson, toolName },
	options,
) => {
	const definitions = await withRemoteMcpAbort(options?.abortSignal, () =>
		discoverRemoteMcpDefinitions(connection),
	);
	if (!definitions.tools.some((definition) => definition.name === toolName)) {
		throw new Error(
			`${connection.displayName} MCP tool "${toolName}" is unavailable.`,
		);
	}
	const args = parseRemoteMcpJson(
		inputJson,
		remoteMcpToolArgumentsSchema,
		`${connection.displayName} MCP tool input is invalid.`,
	);
	const output = await withRemoteMcpClient(
		connection,
		async (client) =>
			await client.callTool({
				name: toolName,
				arguments: args,
				options: { signal: options?.abortSignal },
			}),
		options?.abortSignal,
	);

	return serializeRemoteMcpJson(
		output,
		`${connection.displayName} MCP tool result could not be serialized.`,
	);
};

const withRemoteMcpAbort = async (signal, execute) => {
	signal?.throwIfAborted();
	if (!signal) return await execute();
	let onAbort;
	const aborted = new Promise((_, reject) => {
		onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([execute(), aborted]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
};

export const buildRemoteMcpProxyTools = async (connection, proxy) => {
	const inventoryJson = await proxy.listTools();
	if (inventoryJson.length > REMOTE_MCP_INVENTORY_CHARACTER_LIMIT) {
		throw new Error(
			`${connection.displayName} returned an oversized MCP tool inventory.`,
		);
	}
	const definitions = validateRemoteMcpDefinitions(
		connection,
		parseRemoteMcpJson(
			inventoryJson,
			remoteMcpDefinitionsSchema,
			`${connection.displayName} returned an invalid MCP tool inventory.`,
		),
	);

	return buildRemoteMcpToolsFromDefinitions(
		connection,
		definitions,
		async (definition, args, options) => {
			const inputJson = serializeRemoteMcpJson(
				remoteMcpToolArgumentsSchema.parse(args),
				`${connection.displayName} MCP tool input could not be serialized.`,
			);
			return parseRemoteMcpJson(
				await withRemoteMcpAbort(options?.abortSignal, () =>
					proxy.executeTool({ inputJson, toolName: definition.name }, options),
				),
				remoteMcpToolResultSchema,
				`${connection.displayName} returned an invalid MCP tool result.`,
			);
		},
	);
};
