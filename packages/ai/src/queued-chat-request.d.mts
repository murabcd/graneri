import type { ChatMode } from "./chat-mode.mjs";
import type { ReasoningEffort, ServiceTier } from "./models.mjs";

export type DurableQueuedChatRequest = {
	chatMode: ChatMode;
	mentions?: string[];
	model: string;
	noteContext?:
		| { noteId: string }
		| { noteId: null; text: string; title: string };
	projectId: string | null;
	reasoningEffort: ReasoningEffort;
	recipeSlug?: string | null;
	selectedSourceIds?: string[];
	serviceTier: ServiceTier;
	timezone: string;
	webSearchEnabled: boolean;
};

export declare const parseDurableQueuedChatRequest: (
	value: unknown,
) => DurableQueuedChatRequest | null;
