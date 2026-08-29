import type { CHAT_MODELS } from "@workspace/ai/models";

export type { ReasoningEffort, ServiceTier } from "@workspace/ai/models";
export {
	CHAT_MODELS as chatModels,
	DEFAULT_REASONING_EFFORT,
	DEFAULT_SERVICE_TIER,
	defaultChatModel,
	findChatModel,
	findReasoningEffort,
	findServiceTier,
	getChatModel,
	getOpenAiModelProviderOptions,
	normalizeReasoningEffort,
	normalizeServiceTier,
	REASONING_EFFORTS as reasoningEfforts,
	SERVICE_TIERS as serviceTiers,
} from "@workspace/ai/models";

export type ChatModel = (typeof CHAT_MODELS)[number];
