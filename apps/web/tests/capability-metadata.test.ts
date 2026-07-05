import { describe, expect, it } from "vitest";
import {
	appConnectionProviderLabels,
	appConnectionProviders,
	chatSourceAppConnectionProviders,
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
});
