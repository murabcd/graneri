import type { ChatMode } from "./chat-mode.mjs";
import type { ChatModelId, ReasoningEffort, ServiceTier } from "./models.mjs";

export type ChatSettings = {
	chatMode: ChatMode;
	model: ChatModelId;
	reasoningEffort: ReasoningEffort;
	serviceTier: ServiceTier;
	webSearchEnabled: boolean;
};

export declare const DEFAULT_CHAT_SETTINGS: Readonly<ChatSettings>;

export declare const selectChatSettings: (
	settings: ChatSettings,
) => ChatSettings;

export declare const selectNoteChatSettings: (
	settings: ChatSettings,
) => ChatSettings;

export declare const isNoteChatSettings: (settings: ChatSettings) => boolean;

export declare const mergeNoteChatSettingsIntoDefaults: (
	rememberedSettings: ChatSettings,
	noteSettings: ChatSettings,
) => ChatSettings;

export declare const parseChatSettings: (value: unknown) => ChatSettings | null;
