import type { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { buildConvexWorkspaceToolSet } from "../src/convex-workspace-tools.mjs";

describe("hosted Convex workspace tools", () => {
	it("builds and executes remote MCP tools without loading credentials", async () => {
		const action = vi.fn(async (reference, args) => {
			const functionName = getFunctionName(reference);
			if (functionName === "connectedAppTools:listRemoteMcpTools") {
				return JSON.stringify({
					tools: [
						{
							name: "search",
							description: "Search Notion.",
							inputSchema: {
								type: "object",
								properties: { query: { type: "string" } },
							},
						},
					],
				});
			}
			if (functionName === "connectedAppTools:executeRemoteMcpTool") {
				return JSON.stringify({
					content: [{ type: "text", text: "Result" }],
				});
			}
			throw new Error(
				`Unexpected action ${functionName}: ${JSON.stringify(args)}`,
			);
		});
		const convexClient = {
			action,
			query: vi.fn(),
		} as unknown as ConvexHttpClient;
		const workspaceId = "workspace-id" as never;
		const catalog = await buildConvexWorkspaceToolSet({
			connections: [
				{
					id: "app:notion-id",
					provider: "notion",
					title: "Notion",
					preview: "mcp.notion.com",
				},
			],
			convexClient,
			workspaceId,
		});
		const execute = catalog.tools.notion_search?.execute;
		if (!execute) {
			throw new Error("Expected hosted Notion tool execution.");
		}

		await execute(
			{ query: "roadmap" },
			{ messages: [], toolCallId: "tool-call" },
		);

		expect(action).toHaveBeenNthCalledWith(1, expect.anything(), {
			workspaceId,
			sourceId: "app:notion-id",
		});
		expect(action).toHaveBeenNthCalledWith(2, expect.anything(), {
			workspaceId,
			sourceId: "app:notion-id",
			inputJson: JSON.stringify({ query: "roadmap" }),
			toolName: "search",
		});
		expect(JSON.stringify(action.mock.calls)).not.toContain("token");
		expect(JSON.stringify(action.mock.calls)).not.toContain("password");
	});

	it("executes Yandex Tracker through Convex without loading its token", async () => {
		const action = vi.fn(async (reference) => {
			const functionName = getFunctionName(reference);
			if (
				functionName === "connectedAppTools:searchYandexTrackerIssuesForTool"
			) {
				return { connection: "Tracker", issues: [], sources: [] };
			}
			throw new Error(`Unexpected action ${functionName}`);
		});
		const convexClient = {
			action,
			query: vi.fn(),
		} as unknown as ConvexHttpClient;
		const workspaceId = "workspace-id" as never;
		const catalog = await buildConvexWorkspaceToolSet({
			connections: [
				{
					id: "app:tracker-id",
					provider: "yandex-tracker",
					title: "Tracker",
					preview: "Yandex Tracker",
				},
			],
			convexClient,
			workspaceId,
		});
		const execute = catalog.tools.yandex_tracker_search?.execute;
		if (!execute) {
			throw new Error("Expected hosted Yandex Tracker tool execution.");
		}

		await execute(
			{ query: "PROJ", limit: 3 },
			{ messages: [], toolCallId: "tool-call" },
		);

		expect(action).toHaveBeenCalledWith(expect.anything(), {
			workspaceId,
			sourceId: "app:tracker-id",
			query: "PROJ",
			limit: 3,
		});
		expect(JSON.stringify(action.mock.calls)).not.toContain("token");
	});
});
