import { describe, expect, it } from "vitest";
import { CHAT_MODE } from "../src/chat-mode.mjs";
import { parseDurableQueuedChatRequest } from "../src/queued-chat-request.mjs";

describe("durable queued chat requests", () => {
	it("parses the complete canonical request", () => {
		const request = {
			chatMode: CHAT_MODE.PLAN,
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
				chatMode: CHAT_MODE.DEFAULT,
				localFolders: [{ id: "folder-1", path: "/tmp" }],
				model: "gpt-5.6-sol",
				timezone: "UTC",
			}),
		).toBeNull();
		expect(
			parseDurableQueuedChatRequest({
				chatMode: CHAT_MODE.DEFAULT,
				model: "gpt-5.6-sol",
				text: "legacy duplicate",
				timezone: "UTC",
			}),
		).toBeNull();
	});

	it("requires the fields needed to replay a request", () => {
		expect(
			parseDurableQueuedChatRequest({
				chatMode: CHAT_MODE.DEFAULT,
				model: "gpt-5.6-sol",
			}),
		).toBeNull();
		expect(
			parseDurableQueuedChatRequest({
				chatMode: CHAT_MODE.DEFAULT,
				model: "",
				timezone: "UTC",
			}),
		).toBeNull();
	});
});
