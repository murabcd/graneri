import { describe, expect, it } from "vitest";
import { buildCapabilityToolSet } from "../src/capability-registry.mjs";

describe("calendar capability adapter", () => {
	it("uses the provider-neutral calendar adapter for Yandex tools", async () => {
		const calls: string[] = [];
		const tools = await buildCapabilityToolSet(
			[
				{
					sourceId: "app:yandex-calendar",
					provider: "yandex-calendar",
					displayName: "Yandex Calendar",
					email: "calendar@example.com",
					password: "secret",
					serverAddress: "https://caldav.example.com",
					calendarHomePath: "/calendar/",
				},
			],
			{
				yandexCalendar: {
					listEvents: async () => {
						calls.push("list");
						return {};
					},
					searchEvents: async () => {
						calls.push("search");
						return {};
					},
				},
			},
		);

		await tools.yandex_calendar_list_events?.execute?.(
			{},
			{
				abortSignal: new AbortController().signal,
				messages: [],
				toolCallId: "tool-call-id",
			},
		);
		await tools.yandex_calendar_search_events?.execute?.(
			{ query: "Александр Жирнов" },
			{
				abortSignal: new AbortController().signal,
				messages: [],
				toolCallId: "tool-call-id",
			},
		);

		expect(calls).toEqual(["list", "search"]);
	});
});
