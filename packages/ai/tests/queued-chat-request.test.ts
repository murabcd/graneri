import { describe, expect, it } from "vitest";
import { parseDurableQueuedChatRequest } from "../src/queued-chat-request.mjs";

describe("durable queued chat requests", () => {
	it("parses the complete canonical request", () => {
		const request = {
			mentions: ["note-1"],
			model: "gpt-5.6-sol",
			noteContext: { noteId: null, text: "Body", title: "Plan" },
			reasoningEffort: "high",
			recipeSlug: "review",
			selectedSourceIds: ["source-1"],
			serviceTier: "priority",
			timezone: "Europe/Moscow",
			webSearchEnabled: true,
		};

		expect(parseDurableQueuedChatRequest(request)).toEqual(request);
	});

	it("rejects non-durable and legacy fields", () => {
		expect(
			parseDurableQueuedChatRequest({
				localFolders: [{ id: "folder-1", path: "/tmp" }],
				model: "gpt-5.6-sol",
				timezone: "UTC",
			}),
		).toBeNull();
		expect(
			parseDurableQueuedChatRequest({
				model: "gpt-5.6-sol",
				text: "legacy duplicate",
				timezone: "UTC",
			}),
		).toBeNull();
	});

	it("requires the fields needed to replay a request", () => {
		expect(parseDurableQueuedChatRequest({ model: "gpt-5.6-sol" })).toBeNull();
		expect(
			parseDurableQueuedChatRequest({ model: "", timezone: "UTC" }),
		).toBeNull();
	});
});
