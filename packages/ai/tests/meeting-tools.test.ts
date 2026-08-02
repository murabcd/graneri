import { describe, expect, it } from "vitest";
import { buildMeetingTools } from "../src/meeting-tools.mjs";

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

		const result = await tools.search_meetings.execute?.({
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
});
