export type ChatModelId = "gpt-5.6-sol" | "gpt-5.6-terra" | "gpt-5.6-luna";

export type ChatModel = {
	id: ChatModelId;
	name: string;
	model: ChatModelId;
};

export declare const CHAT_MODELS: readonly ChatModel[];
export declare const GPT_5_6_SOL_MODEL_ID: "gpt-5.6-sol";
export declare const GPT_5_6_TERRA_MODEL_ID: "gpt-5.6-terra";
export declare const GPT_5_6_LUNA_MODEL_ID: "gpt-5.6-luna";
export declare const DEFAULT_CHAT_MODEL_ID: ChatModelId;
export declare const NOTE_GENERATION_MODEL_ID: ChatModelId;
export declare const PROJECT_DESCRIPTION_MODEL_ID: ChatModelId;
export declare const CHAT_TITLE_MODEL_ID: ChatModelId;
export declare const CONTEXT_COMPACTION_MODEL_ID: ChatModelId;
export declare const AUTOMATION_DELIVERY_MODEL_ID: ChatModelId;
export declare const defaultChatModel: ChatModel;
export declare const findChatModel: (
	value?: string | null,
) => ChatModel | undefined;
export declare const getChatModel: (value: string) => ChatModel;
export declare const isSupportedChatModel: (
	value?: string | null,
) => value is ChatModelId;
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type ReasoningEffortOption = {
	id: ReasoningEffort;
	name: string;
};
export declare const REASONING_EFFORTS: readonly ReasoningEffortOption[];
export declare const DEFAULT_REASONING_EFFORT: ReasoningEffort;
export declare const findReasoningEffort: (
	value?: string | null,
) => ReasoningEffortOption | undefined;
export declare const normalizeReasoningEffort: (
	value?: string | null,
) => ReasoningEffort;
export type ServiceTier = "auto" | "priority";
export type ServiceTierOption = {
	id: ServiceTier;
	name: string;
};
export declare const SERVICE_TIERS: readonly ServiceTierOption[];
export declare const DEFAULT_SERVICE_TIER: ServiceTier;
export declare const findServiceTier: (
	value?: string | null,
) => ServiceTierOption | undefined;
export declare const normalizeServiceTier: (
	value?: string | null,
) => ServiceTier;
export declare const getOpenAiModelProviderOptions: (
	model: string,
	options?: {
		reasoningEffort?: "none" | ReasoningEffort | null;
		safetyIdentifier?: string;
		serviceTier?: ServiceTier | null;
	},
) =>
	| {
			openai: {
				reasoningSummary?: "auto";
				reasoningEffort?: "none" | ReasoningEffort;
				safetyIdentifier?: string;
				serviceTier?: ServiceTier;
			};
	  }
	| undefined;
