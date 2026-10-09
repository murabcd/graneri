import type { ChatMode } from "./chat-mode.mjs";
import type {
	ChatModelId,
	LEGACY_CHAT_MODEL_IDS,
	ReasoningEffort,
	ServiceTier,
} from "./models.mjs";

export type ChatSettings = {
	chatMode: ChatMode;
	model: ChatModelId;
	reasoningEffort: ReasoningEffort;
	serviceTier: ServiceTier;
	webSearchEnabled: boolean;
};

export declare const DEFAULT_CHAT_SETTINGS: Readonly<ChatSettings>;

export type StoredChatSettings = Omit<ChatSettings, "model"> & {
	model: ChatModelId | keyof typeof LEGACY_CHAT_MODEL_IDS;
};

export declare const selectChatSettings: (
	settings: StoredChatSettings,
) => ChatSettings;

export declare const selectNoteChatSettings: (
	settings: StoredChatSettings,
) => ChatSettings;

export declare const isNoteChatSettings: (settings: ChatSettings) => boolean;

export declare const mergeNoteChatSettingsIntoDefaults: (
	rememberedSettings: ChatSettings,
	noteSettings: ChatSettings,
) => ChatSettings;

export declare const parseChatSettings: (value: unknown) => ChatSettings | null;
