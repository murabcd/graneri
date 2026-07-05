import { describe, expect, it } from "vitest";
import {
	CHAT_APP_SOURCE_PROVIDERS,
	getAppSourceLabel,
	isChatAppSourceProvider,
} from "@/lib/chat-source-display";

describe("chat source display", () => {
	it("uses tool labels for connected app sources", () => {
		expect(getAppSourceLabel("notion")).toBe("Notion");
		expect(getAppSourceLabel("posthog")).toBe("PostHog");
		expect(getAppSourceLabel("yandex-tracker")).toBe("Yandex Tracker");
		expect(getAppSourceLabel("jira")).toBe("Jira");
	});

	it("uses the shared app source provider catalog", () => {
		expect(CHAT_APP_SOURCE_PROVIDERS).toContain("context7");
		expect(isChatAppSourceProvider("jira-mcp")).toBe(true);
		expect(isChatAppSourceProvider("missing-provider")).toBe(false);
	});
});
