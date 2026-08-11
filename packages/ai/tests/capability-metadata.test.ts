import { describe, expect, it } from "vitest";
import {
	appConnectionProviderLabels,
	appConnectionProviders,
	appSourceProviders,
	capabilityMetadataDefinitions,
	chatSourceAppConnectionProviders,
	getCapabilitySettings,
	getChatAppSourceDescription,
	isMcpSdkOAuthConnectionProvider,
	mcpSdkOAuthConnectionProviders,
	remoteMcpConnectionDefaults,
	tokenRequiredChatSourceAppConnectionProviders,
} from "../src/capability-metadata.mjs";
import {
	buildCapabilityToolSet,
	graneriCapabilityRegistry,
} from "../src/capability-registry.mjs";

describe("capability metadata", () => {
	it("defines labels for every app connection provider", () => {
		for (const provider of appConnectionProviders) {
			expect(appConnectionProviderLabels[provider]).toEqual(expect.any(String));
			expect(appConnectionProviderLabels[provider].length).toBeGreaterThan(0);
		}
	});

	it("classifies every canonical capability through the public catalog", () => {
		const ids = capabilityMetadataDefinitions.map(
			(capability) => capability.id,
		);

		expect(new Set(ids).size).toBe(ids.length);
		for (const capability of capabilityMetadataDefinitions) {
			expect(capability.sourceDescription).toEqual(expect.any(String));
			expect(capability.sourceDescription.length).toBeGreaterThan(0);
			expect(appSourceProviders.includes(capability.id)).toBe(
				capability.sourceKind === "app",
			);
			expect(appConnectionProviders.includes(capability.id)).toBe(
				Boolean(capability.connection),
			);
			expect(chatSourceAppConnectionProviders.includes(capability.id)).toBe(
				capability.connection?.usage === "chat",
			);
		}
		expect(getChatAppSourceDescription("context7")).toBe(
			"Up-to-date library and API documentation",
		);
	});

	it("registers tools and settings for every app capability", () => {
		for (const provider of appSourceProviders) {
			const capability = graneriCapabilityRegistry[provider];
			expect(capability?.buildTools).toEqual(expect.any(Function));
			expect(capability?.toolNamespace).toEqual({
				name: expect.any(String),
				description: expect.any(String),
			});
			expect(getCapabilitySettings(provider)).toEqual({
				group: expect.any(String),
				name: expect.any(String),
			});
		}

		expect(getCapabilitySettings("jira")).toEqual({
			group: "Tracking",
			name: "Jira Sync",
		});
		expect(() => getCapabilitySettings("unknown")).toThrow(
			"Unknown connected capability: unknown",
		);
	});

	it("adds OpenAI tool-search namespaces to connected app tools", async () => {
		const tools = await buildCapabilityToolSet(
			[
				{
					id: "app:google-calendar",
					provider: "google-calendar",
					title: "Google Calendar",
					preview: "Google account",
				},
			],
			{
				googleCalendar: {
					listEvents: async () => [],
					searchEvents: async () => [],
				},
			},
		);

		expect(
			tools.google_calendar_search_events?.providerOptions?.openai,
		).toMatchObject({
			deferLoading: true,
			namespace: {
				name: "google_calendar",
				description: expect.any(String),
			},
		});
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

	it("defines providers that use the MCP SDK OAuth flow", () => {
		expect(mcpSdkOAuthConnectionProviders).toEqual([
			"figma",
			"jira-mcp",
			"linear",
			"posthog",
		]);
		expect(isMcpSdkOAuthConnectionProvider("figma")).toBe(true);
		expect(isMcpSdkOAuthConnectionProvider("notion")).toBe(false);
		expect(isMcpSdkOAuthConnectionProvider("zoom")).toBe(false);
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
