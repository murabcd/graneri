import { describe, expect, it } from "vitest";
import {
	appConnectionProviderLabels,
	appConnectionProviders,
	chatSourceAppConnectionProviders,
	remoteMcpConnectionDefaults,
	tokenRequiredChatSourceAppConnectionProviders,
} from "../../../packages/ai/src/capability-metadata.mjs";

describe("capability metadata", () => {
	it("defines labels for every app connection provider", () => {
		for (const provider of appConnectionProviders) {
			expect(appConnectionProviderLabels[provider]).toEqual(expect.any(String));
			expect(appConnectionProviderLabels[provider].length).toBeGreaterThan(0);
		}
	});

	it("keeps sync-only Jira out of chat app connection sources", () => {
		expect(appConnectionProviders).toContain("jira");
		expect(chatSourceAppConnectionProviders).not.toContain("jira");
	});

	it("limits chat source token requirements to OAuth providers that need tokens", () => {
		expect(tokenRequiredChatSourceAppConnectionProviders).toEqual([
			"figma",
			"linear",
		]);
	});

	it("defines remote MCP defaults from the provider catalog", () => {
		expect(remoteMcpConnectionDefaults).toMatchObject({
			context7: {
				displayName: appConnectionProviderLabels.context7,
				endpoint: "https://mcp.context7.com/mcp",
			},
			figma: {
				displayName: appConnectionProviderLabels.figma,
				endpoint: "https://mcp.figma.com/mcp",
			},
			"jira-mcp": {
				displayName: appConnectionProviderLabels["jira-mcp"],
				endpoint: "https://mcp.atlassian.com/v1/mcp",
			},
			linear: {
				displayName: appConnectionProviderLabels.linear,
				endpoint: "https://mcp.linear.app/mcp",
			},
			notion: {
				displayName: appConnectionProviderLabels.notion,
				endpoint: "https://mcp.notion.com/mcp",
			},
			posthog: {
				displayName: appConnectionProviderLabels.posthog,
				endpoint: "https://mcp.posthog.com/mcp",
			},
			zoom: {
				displayName: appConnectionProviderLabels.zoom,
				endpoint: "https://mcp.zoom.us/mcp/zoom/streamable",
			},
		});
	});
});
