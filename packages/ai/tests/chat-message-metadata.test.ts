import { describe, expect, it } from "vitest";
import { parseChatMessageMetadata } from "../src/chat-message-metadata.mjs";

describe("chat message metadata", () => {
	it("parses the canonical metadata shape", () => {
		expect(
			parseChatMessageMetadata({
				interrupted: false,
				mentionPositions: [
					{ from: 0, id: "note-1", label: "Plan", to: 5, type: "note" },
					{
						from: 6,
						id: "tool-1",
						label: "Drive",
						provider: "google-drive",
						to: 11,
						type: "tool",
					},
				],
				recipe: { name: "Review", slug: "review" },
				recipeOnly: false,
			}),
		).toEqual({
			interrupted: false,
			mentionPositions: [
				{ from: 0, id: "note-1", label: "Plan", to: 5, type: "note" },
				{
					from: 6,
					id: "tool-1",
					label: "Drive",
					provider: "google-drive",
					to: 11,
					type: "tool",
				},
			],
			recipe: { name: "Review", slug: "review" },
			recipeOnly: false,
		});
	});

	it("rejects incomplete recipes and invalid mention ranges", () => {
		expect(
			parseChatMessageMetadata({
				recipe: { name: "Review", slug: "review" },
			}),
		).toBeNull();
		expect(
			parseChatMessageMetadata({
				mentionPositions: [
					{ from: 4, id: "note-1", label: "Plan", to: 4, type: "note" },
				],
			}),
		).toBeNull();
		expect(
			parseChatMessageMetadata({ selectedModel: "gpt-5.6-sol" }),
		).toBeNull();
	});
});
