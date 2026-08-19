import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { collectMessageSources } from "../src/lib/chat-sources";

describe("collectMessageSources", () => {
	it("shows web search citations without exposing app result links", () => {
		const message: UIMessage = {
			id: "assistant-1",
			role: "assistant",
			parts: [
				{
					type: "dynamic-tool",
					toolCallId: "calendar-1",
					toolName: "yandex_calendar_list_events",
					state: "output-available",
					input: { date: "2026-08-20" },
					output: {
						sources: [
							{
								title: "Daily meeting",
								url: "https://calendar.yandex.com/event?event_id=1",
							},
						],
					},
				},
				{
					type: "dynamic-tool",
					toolCallId: "web-1",
					toolName: "web_search",
					state: "output-available",
					input: { query: "Graneri" },
					output: {
						sources: [
							{
								title: "Graneri",
								url: "https://graneri.app",
							},
						],
					},
				},
			],
		};

		expect(collectMessageSources(message)).toEqual([
			{ href: "https://graneri.app", title: "Graneri" },
		]);
	});
});
