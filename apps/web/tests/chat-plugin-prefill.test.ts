import { describe, expect, it } from "vitest";
import { createChatPluginDraft } from "../src/lib/chat-plugin-prefill";

describe("chat plugin prefill", () => {
	it("creates composer text and mention metadata from a plugin selection", () => {
		expect(
			createChatPluginDraft({
				provider: "context7",
				sourceId: "app:context7-source",
			}),
		).toEqual({
			text: "@Context7 ",
			metadata: {
				mentions: [
					{
						from: 0,
						id: "app:context7-source",
						label: "Context7",
						provider: "context7",
						to: 9,
						type: "tool",
					},
				],
			},
		});
	});
});
