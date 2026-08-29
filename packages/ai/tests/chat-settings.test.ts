import { describe, expect, it } from "vitest";
import { CHAT_MODE } from "../src/chat-mode.mjs";
import {
	DEFAULT_CHAT_SETTINGS,
	parseChatSettings,
} from "../src/chat-settings.mjs";

describe("chat settings contract", () => {
	it("defines a complete valid new-chat default", () => {
		expect(parseChatSettings(DEFAULT_CHAT_SETTINGS)).toEqual(
			DEFAULT_CHAT_SETTINGS,
		);
	});

	it("accepts all five explicit settings", () => {
		expect(
			parseChatSettings({
				chatMode: CHAT_MODE.PLAN,
				model: "gpt-5.6-terra",
				reasoningEffort: "xhigh",
				serviceTier: "priority",
				webSearchEnabled: true,
			}),
		).toEqual({
			chatMode: CHAT_MODE.PLAN,
			model: "gpt-5.6-terra",
			reasoningEffort: "xhigh",
			serviceTier: "priority",
			webSearchEnabled: true,
		});
	});

	it("rejects incomplete, unsupported, and extended settings", () => {
		expect(
			parseChatSettings({
				...DEFAULT_CHAT_SETTINGS,
				serviceTier: undefined,
			}),
		).toBeNull();
		expect(
			parseChatSettings({
				...DEFAULT_CHAT_SETTINGS,
				model: "unsupported",
			}),
		).toBeNull();
		expect(
			parseChatSettings({ ...DEFAULT_CHAT_SETTINGS, legacyMode: true }),
		).toBeNull();
	});
});
