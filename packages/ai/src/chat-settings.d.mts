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

export declare const parseChatSettings: (value: unknown) => ChatSettings | null;
