import { beforeEach, describe, expect, it, vi } from "vitest";

const mcpMocks = vi.hoisted(() => ({
	close: vi.fn(async () => undefined),
	callTool: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })),
	createClient: vi.fn(),
	listTools: vi.fn(async () => ({
		tools: [
			{
				name: "search",
				description: "Search the connected workspace.",
				inputSchema: { type: "object", properties: {} },
			},
		],
	})),
	toolsFromDefinitions: vi.fn((definitions) =>
		Object.fromEntries(
			definitions.tools.map((definition: { name: string }) => [
				definition.name,
				{
					description: "Search the connected workspace.",
					inputSchema: {},
					execute: vi.fn(async () => ({ ok: true })),
				},
			]),
		),
	),
}));

vi.mock("@ai-sdk/mcp", () => {
	mcpMocks.createClient.mockImplementation(async () => ({
		callTool: mcpMocks.callTool,
		close: mcpMocks.close,
		listTools: mcpMocks.listTools,
		toolsFromDefinitions: mcpMocks.toolsFromDefinitions,
	}));

	return { createMCPClient: mcpMocks.createClient };
});

import {
	buildRemoteMcpProxyTools,
	buildRemoteMcpTools,
	executeRemoteMcpToolForProxy,
} from "../src/remote-mcp-tools.mjs";

describe("remote MCP tool discovery", () => {
	beforeEach(() => {
		mcpMocks.close.mockClear();
		mcpMocks.callTool.mockClear();
		mcpMocks.createClient.mockClear();
		mcpMocks.listTools.mockClear();
		mcpMocks.toolsFromDefinitions.mockClear();
	});

	it("builds hosted tools from a credential-free Convex proxy", async () => {
		const executeTool = vi.fn(async () =>
			JSON.stringify({ content: [{ type: "text", text: "proxied" }] }),
		);
		const tools = await buildRemoteMcpProxyTools(
			{
				sourceId: "app:test-proxy",
				provider: "notion",
				displayName: "Notion",
				toolPrefix: "notion",
			},
			{
				listTools: async () =>
					JSON.stringify({
						tools: [
							{
								name: "search",
								description: "Search the connected workspace.",
								inputSchema: {
									type: "object",
									properties: { query: { type: "string" } },
								},
							},
						],
					}),
				executeTool,
			},
		);
		const execute = tools.notion_search?.execute;
		if (!execute) {
			throw new Error("Expected proxied Notion tool execution.");
		}

		await execute(
			{ query: "roadmap" },
			{ messages: [], toolCallId: "tool-call" },
		);

		expect(executeTool).toHaveBeenCalledWith({
			inputJson: JSON.stringify({ query: "roadmap" }),
			toolName: "search",
		});
	});

	it("executes remote tools inside the credential-holding proxy", async () => {
		const connection = {
			sourceId: "app:test-server-proxy",
			provider: "notion",
			displayName: "Notion",
			baseUrl: "https://mcp.example.com",
			oauthAccessToken: "secret-token",
		};

		await expect(
			executeRemoteMcpToolForProxy(connection, {
				inputJson: JSON.stringify({ query: "roadmap" }),
				toolName: "search",
			}),
		).resolves.toBe(
			JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
		);
		expect(mcpMocks.callTool).toHaveBeenCalledWith({
			name: "search",
			arguments: { query: "roadmap" },
		});
	});

	it("caches bounded discovery results between chat turns", async () => {
		const connection = {
			sourceId: "app:test-remote-cache",
			provider: "notion",
			displayName: "Notion",
			baseUrl: "https://mcp.example.com",
			oauthAccessToken: "token",
		};

		const firstTools = await buildRemoteMcpTools(connection);
		const secondTools = await buildRemoteMcpTools(connection);

		expect(firstTools.notion_search).toBeDefined();
		expect(secondTools.notion_search).toBeDefined();
		expect(mcpMocks.createClient).toHaveBeenCalledTimes(1);
		expect(mcpMocks.listTools).toHaveBeenCalledTimes(1);
	});

	it("shares one in-flight discovery across concurrent chat turns", async () => {
		type ToolInventory = {
			tools: Array<{
				name: string;
				description: string;
				inputSchema: { type: string; properties: Record<string, never> };
			}>;
		};
		let resolveInventory!: (inventory: ToolInventory) => void;
		const inventoryPromise = new Promise<ToolInventory>((resolve) => {
			resolveInventory = resolve;
		});
		mcpMocks.listTools.mockImplementationOnce(async () => inventoryPromise);
		const connection = {
			sourceId: "app:test-remote-concurrent",
			provider: "notion",
			displayName: "Notion",
			baseUrl: "https://mcp.example.com",
			oauthAccessToken: "token",
		};

		const firstTools = buildRemoteMcpTools(connection);
		const secondTools = buildRemoteMcpTools(connection);
		await vi.waitFor(() => {
			expect(mcpMocks.createClient).toHaveBeenCalledTimes(1);
		});
		resolveInventory({
			tools: [
				{
					name: "search",
					description: "Search the connected workspace.",
					inputSchema: { type: "object", properties: {} },
				},
			],
		});

		await expect(Promise.all([firstTools, secondTools])).resolves.toHaveLength(
			2,
		);
		expect(mcpMocks.listTools).toHaveBeenCalledTimes(1);
	});

	it("rejects an unbounded remote tool inventory", async () => {
		mcpMocks.listTools.mockResolvedValueOnce({
			tools: Array.from({ length: 257 }, (_, index) => ({
				name: `tool-${index}`,
				description: "Remote tool",
				inputSchema: { type: "object", properties: {} },
			})),
		});

		await expect(
			buildRemoteMcpTools({
				sourceId: "app:test-remote-unbounded",
				provider: "notion",
				displayName: "Notion",
				baseUrl: "https://mcp.example.com",
				oauthAccessToken: "token",
			}),
		).rejects.toThrow("more than 256 MCP tools");
	});
});
