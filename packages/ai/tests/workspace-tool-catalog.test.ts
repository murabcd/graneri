import { describe, expect, it } from "vitest";
import type { WorkspaceToolConnection } from "../src/capability-registry.mjs";
import { buildWorkspaceToolCatalog } from "../src/workspace-tool-catalog.mjs";

const connections: WorkspaceToolConnection[] = [
	{
		id: "app:google-calendar",
		provider: "google-calendar",
		preview: "calendar@example.com",
		title: "Google Calendar",
	},
];

describe("workspace tool catalog", () => {
	it("keeps all available tools while treating mentions as prompt guidance", async () => {
		const catalog = await buildWorkspaceToolCatalog({
			adapters: {
				googleCalendar: {
					listEvents: async () => ({}),
					searchEvents: async () => ({}),
				},
			},
			connections,
			scope: "available",
			selectedSourceIds: [],
		});

		expect(catalog.tools.google_calendar_search_events).toBeDefined();
		expect(catalog.selectedConnections).toEqual([]);
	});

	it("keeps workspace tools when connected apps are disabled", async () => {
		const meetingTool = { description: "Search notes" };
		const catalog = await buildWorkspaceToolCatalog({
			connections,
			meetingTools: { search_meeting_notes: meetingTool },
			scope: "disabled",
		});

		expect(catalog.tools).toEqual({ search_meeting_notes: meetingTool });
	});
});
