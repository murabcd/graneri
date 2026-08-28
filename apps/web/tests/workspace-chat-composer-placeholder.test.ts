import { CHAT_MODE } from "@workspace/ai/chat-mode";
import { describe, expect, it } from "vitest";
import { resolveWorkspaceChatComposerPlaceholder } from "@/lib/workspace-chat-composer-placeholder";

describe("workspace chat composer placeholder", () => {
	it("uses follow-up copy while a known stored chat hydrates its messages", () => {
		expect(
			resolveWorkspaceChatComposerPlaceholder({
				chatMode: CHAT_MODE.DEFAULT,
				hasMessages: false,
				hasStoredChat: true,
			}),
		).toBe("Ask for follow-up");
	});

	it("keeps the general copy for a new draft chat", () => {
		expect(
			resolveWorkspaceChatComposerPlaceholder({
				chatMode: CHAT_MODE.DEFAULT,
				hasMessages: false,
				hasStoredChat: false,
			}),
		).toBe("Ask anything. @ to use recipes, tools, or notes");
	});

	it("keeps plan mode copy independent of chat persistence", () => {
		expect(
			resolveWorkspaceChatComposerPlaceholder({
				chatMode: CHAT_MODE.PLAN,
				hasMessages: false,
				hasStoredChat: true,
			}),
		).toBe("Describe your task to generate a plan...");
	});
});
