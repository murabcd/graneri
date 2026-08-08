import { describe, expect, it } from "vitest";
import { buildGoogleCalendarToolDefinitions } from "../src/google-calendar-tools.mjs";
import { buildMeetingTools } from "../src/meeting-tools.mjs";
import { toolUiMetadata } from "../src/tool-ui-metadata.mjs";
import { buildYandexCalendarToolDefinitions } from "../src/yandex-calendar-tools.mjs";

describe("meeting tools", () => {
	it("forwards person, company, and date search input to the canonical adapter", async () => {
		const calls: unknown[] = [];
		const tools = buildMeetingTools({
			searchMeetings: async (input) => {
				calls.push(input);
				return {
					hasMore: false,
					matchedCompanies: [],
					matchedPeople: [{ displayName: "Mark", email: "mark@example.com" }],
					meetings: [
						{
							endAt: "2026-01-14T11:00:00.000Z",
							matchedCompanies: [],
							matchedPeople: ["Mark"],
							noteId: "note_1",
							provider: "google",
							searchableText: "Customer review notes",
							searchableTextTruncated: false,
							startAt: "2026-01-14T10:00:00.000Z",
							title: "Customer review",
						},
					],
				};
			},
		});

		const result = await tools.search_meeting_notes.execute?.({
			query: "Mark",
			from: "2026-01-14T00:00:00.000Z",
			to: "2026-01-15T00:00:00.000Z",
			limit: 5,
		});

		expect(calls).toEqual([
			{
				query: "Mark",
				from: "2026-01-14T00:00:00.000Z",
				to: "2026-01-15T00:00:00.000Z",
				limit: 5,
			},
		]);
		expect(result).toMatchObject({
			meetings: [{ title: "Customer review" }],
		});
	});

	it("keeps saved meeting knowledge distinct from provider schedules", () => {
		const adapter = {
			listEvents: async () => undefined,
			searchEvents: async () => undefined,
		};
		const googleSearch = buildGoogleCalendarToolDefinitions(adapter).find(
			(tool) => tool.name === "google_calendar_search_events",
		);
		const yandexSearch = buildYandexCalendarToolDefinitions(adapter).find(
			(tool) => tool.name === "yandex_calendar_search_events",
		);

		expect(googleSearch?.description).toContain("attendee name");
		expect(yandexSearch?.description).toContain("attendee name");
		expect(yandexSearch?.description).toContain("meetings are scheduled");
		expect(toolUiMetadata.search_meeting_notes.complete).toBe(
			"Searched meeting notes",
		);
	});
});
