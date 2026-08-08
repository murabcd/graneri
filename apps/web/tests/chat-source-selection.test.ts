import {
	getSelectedAppSourceIds,
	getSelectedNoteSourceIds,
} from "@workspace/ai/capability-metadata";
import {
	buildWorkspaceToolCatalog,
	loadWorkspaceToolConnections,
} from "@workspace/ai/workspace-tool-catalog";
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
		const connections = await loadWorkspaceToolConnections([
			{
				label: "Apps",
				load: async () => [
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
			},
			{
				label: "Google",
				load: async () => [
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
			},
		]);

		expect(connections.map((connection) => connection.provider)).toEqual([
			"notion",
			"yandex-calendar",
			"google-calendar",
			"google-drive",
		]);
	});

	it("uses app mentions as guidance without restricting available tools", async () => {
		const connections = await loadWorkspaceToolConnections([
			{
				label: "Apps",
				load: async () => [
					{
						sourceId: "app:notion-1",
						provider: "notion",
						displayName: "Notion workspace",
					},
				],
			},
			{
				label: "Google",
				load: async () => [
					{
						id: "app:google-calendar",
						provider: "google-calendar",
						title: "Google Calendar",
					},
				],
			},
		]);

		const catalog = await buildWorkspaceToolCatalog({
			connections,
			scope: "disabled",
			selectedSourceIds: ["app:notion-1"],
		});
		expect(catalog.selectedConnections).toEqual([
			{
				sourceId: "app:notion-1",
				provider: "notion",
				displayName: "Notion workspace",
			},
		]);
		expect(connections).toHaveLength(2);
	});

	it("deduplicates the same connection identity", async () => {
		const connections = await loadWorkspaceToolConnections([
			{
				label: "Apps",
				load: async () => [
					{
						id: "app:google-calendar",
						provider: "google-calendar",
						title: "Duplicate",
					},
				],
			},
			{
				label: "Google",
				load: async () => [
					{
						id: "app:google-calendar",
						provider: "google-calendar",
						title: "Google Calendar",
					},
				],
			},
		]);

		expect(connections).toEqual([
			{
				id: "app:google-calendar",
				provider: "google-calendar",
				title: "Google Calendar",
			},
		]);
	});

	it("isolates one failed source inventory from the others", async () => {
		const connections = await loadWorkspaceToolConnections([
			{
				label: "Google",
				load: async () => {
					throw new Error("Google unavailable");
				},
			},
			{
				label: "Apps",
				load: async () => [
					{
						sourceId: "app:notion-1",
						provider: "notion",
						displayName: "Notion workspace",
					},
				],
			},
		]);

		expect(connections).toEqual([
			{
				sourceId: "app:notion-1",
				provider: "notion",
				displayName: "Notion workspace",
			},
		]);
	});
});
