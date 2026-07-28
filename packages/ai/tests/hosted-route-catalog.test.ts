import { describe, expect, it } from "vitest";
import {
	buildHostedChatStreamPath,
	buildHostedRoutePath,
	getHostedRouteDefinition,
	hostedRouteIds,
	matchHostedRoutePath,
} from "../src/hosted-route-catalog.mjs";

describe("hosted route catalog", () => {
	it("owns every hosted route and its HTTP contract", () => {
		expect(hostedRouteIds).toEqual([
			"chat",
			"chatSteer",
			"chatStop",
			"chatStream",
			"enhanceNote",
			"generateProjectDescription",
			"applyTemplate",
			"realtimeTranscriptionSession",
		]);
		expect(getHostedRouteDefinition("chatStream")).toMatchObject({
			method: "GET",
			proxyBodyMode: "stream",
		});
		expect(getHostedRouteDefinition("enhanceNote")).toMatchObject({
			method: "POST",
			proxyBodyMode: "bufferedJson",
		});
		expect(
			getHostedRouteDefinition("generateProjectDescription"),
		).toMatchObject({
			method: "POST",
			proxyBodyMode: "bufferedJson",
		});
	});

	it("builds and matches static and parameterized paths", () => {
		expect(buildHostedRoutePath("chatSteer")).toBe("/api/chat/steer");
		expect(buildHostedRoutePath("generateProjectDescription")).toBe(
			"/api/generate-project-description",
		);
		expect(buildHostedChatStreamPath("chat / one")).toBe(
			"/api/chat/chat%20%2F%20one/stream",
		);
		expect(matchHostedRoutePath("/api/chat/chat%20one/stream")?.id).toBe(
			"chatStream",
		);
		expect(matchHostedRoutePath("/api/unknown")).toBeNull();
	});

	it("rejects an empty chat stream identifier", () => {
		expect(() => buildHostedChatStreamPath("")).toThrow(
			"chatStream route requires a chatId.",
		);
	});
});
