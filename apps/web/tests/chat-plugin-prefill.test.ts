import { describe, expect, it } from "vitest";
import {
	consumeChatPluginPrefill,
	createChatPluginDraft,
} from "../src/lib/chat-plugin-prefill";

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

	it("consumes the prefill after its fresh chat is persisted", () => {
		const prefill = {
			composerId: "chat-from-plugin",
			provider: "yandex-calendar" as const,
			sourceId: "app:yandex-calendar",
		};

		expect(
			consumeChatPluginPrefill({
				chatId: "chat-from-plugin",
				prefill,
			}),
		).toBeNull();
		expect(
			consumeChatPluginPrefill({
				chatId: "another-chat",
				prefill,
			}),
		).toBe(prefill);
	});
});
