import { describe, expect, it } from "vitest";
import { CHAT_MODE } from "../src/chat-mode.mjs";
import {
	DEFAULT_CHAT_SETTINGS,
	isNoteChatSettings,
	mergeNoteChatSettingsIntoDefaults,
	parseChatSettings,
	selectChatSettings,
	selectNoteChatSettings,
} from "../src/chat-settings.mjs";

describe("chat settings contract", () => {
	it("projects stored objects to the five-field contract", () => {
		const storedSettings = {
			...DEFAULT_CHAT_SETTINGS,
			_creationTime: 1,
			_id: "chat-1",
		};
		expect(selectChatSettings(storedSettings)).toEqual(DEFAULT_CHAT_SETTINGS);
	});

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

	it("keeps note chats in default mode without web search", () => {
		const noteSettings = selectNoteChatSettings({
			chatMode: CHAT_MODE.PLAN,
			model: "gpt-5.6-terra",
			reasoningEffort: "xhigh",
			serviceTier: "priority",
			webSearchEnabled: true,
		});

		expect(noteSettings).toEqual({
			chatMode: CHAT_MODE.DEFAULT,
			model: "gpt-5.6-terra",
			reasoningEffort: "xhigh",
			serviceTier: "priority",
			webSearchEnabled: false,
		});
		expect(isNoteChatSettings(noteSettings)).toBe(true);
		expect(
			isNoteChatSettings({ ...noteSettings, webSearchEnabled: true }),
		).toBe(false);
	});

	it("updates visible note defaults without replacing hidden capabilities", () => {
		const rememberedSettings = {
			chatMode: CHAT_MODE.PLAN,
			model: "gpt-5.6-sol" as const,
			reasoningEffort: "low" as const,
			serviceTier: "auto" as const,
			webSearchEnabled: true,
		};
		const noteSettings = selectNoteChatSettings({
			...rememberedSettings,
			model: "gpt-5.6-luna",
			reasoningEffort: "high",
			serviceTier: "priority",
		});

		expect(
			mergeNoteChatSettingsIntoDefaults(rememberedSettings, noteSettings),
		).toEqual({
			chatMode: CHAT_MODE.PLAN,
			model: "gpt-5.6-luna",
			reasoningEffort: "high",
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
