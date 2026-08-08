import {
	getSelectedAppSourceIds,
	getSelectedNoteSourceIds,
	loadAvailableChatToolConnections,
	selectAppSourceConnections,
} from "@workspace/ai/capability-metadata";
import { describe, expect, it } from "vitest";

describe("chat source selection", () => {
	it("keeps app mentions separate from note mentions", () => {
		expect(getSelectedAppSourceIds(["app:notion", "note-1"])).toEqual([
			"app:notion",
		]);
		expect(getSelectedNoteSourceIds({ mentions: ["note-1"] })).toEqual([
			"note-1",
		]);
	});

	it("loads every available Google and workspace connection by default", async () => {
		const connections = await loadAvailableChatToolConnections({
			listGoogleSources: async () => [
				{
					id: "app:google-calendar",
					provider: "google-calendar",
					title: "Google Calendar",
				},
				{
					id: "app:google-drive",
					provider: "google-drive",
					title: "Google Drive",
				},
			],
			getAppConnections: async () => [
				{
					sourceId: "app:notion-1",
					provider: "notion",
					displayName: "Notion workspace",
				},
				{
					sourceId: "app:yandex-calendar-1",
					provider: "yandex-calendar",
					displayName: "Yandex Calendar",
				},
			],
		});

		expect(connections.map((connection) => connection.provider)).toEqual([
			"notion",
			"yandex-calendar",
			"google-calendar",
			"google-drive",
		]);
	});

	it("uses app mentions as guidance without restricting available tools", async () => {
		const connections = await loadAvailableChatToolConnections({
			listGoogleSources: async () => [
				{
					id: "app:google-calendar",
					provider: "google-calendar",
					title: "Google Calendar",
				},
			],
			getAppConnections: async () => [
				{
					sourceId: "app:notion-1",
					provider: "notion",
					displayName: "Notion workspace",
				},
			],
		});

		expect(selectAppSourceConnections(connections, ["app:notion-1"])).toEqual([
			{
				sourceId: "app:notion-1",
				provider: "notion",
				displayName: "Notion workspace",
			},
		]);
		expect(connections).toHaveLength(2);
	});

	it("deduplicates the same connection identity", async () => {
		const connections = await loadAvailableChatToolConnections({
			listGoogleSources: async () => [
				{
					id: "app:google-calendar",
					provider: "google-calendar",
					title: "Google Calendar",
				},
			],
			getAppConnections: async () => [
				{
					id: "app:google-calendar",
					provider: "google-calendar",
					title: "Duplicate",
				},
			],
		});

		expect(connections).toEqual([
			{
				id: "app:google-calendar",
				provider: "google-calendar",
				title: "Google Calendar",
			},
		]);
	});

	it("isolates one failed source inventory from the others", async () => {
		const connections = await loadAvailableChatToolConnections({
			listGoogleSources: async () => {
				throw new Error("Google unavailable");
			},
			getAppConnections: async () => [
				{
					sourceId: "app:notion-1",
					provider: "notion",
					displayName: "Notion workspace",
				},
			],
		});

		expect(connections).toEqual([
			{
				sourceId: "app:notion-1",
				provider: "notion",
				displayName: "Notion workspace",
			},
		]);
	});
});
