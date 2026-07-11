export type ChatModel = {
	id: string;
	name: string;
	model: string;
};

export declare const CHAT_MODELS: readonly ChatModel[];
export declare const DEFAULT_CHAT_MODEL_ID: string;
export declare const CHAT_TITLE_MODEL_ID: string;
export declare const NOTE_CHAT_MODEL_ID: string;
export declare const NOTE_GENERATION_MODEL_ID: string;
export declare const CHAT_SERVER_MODELS: readonly ChatModel[];
export declare const defaultChatModel: ChatModel;
export declare const findChatModel: (
	value?: string | null,
) => ChatModel | undefined;
export declare const getChatModel: (value: string) => ChatModel;
export declare const isSupportedChatModel: (value?: string | null) => boolean;
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
export declare const getChatModelProviderOptions: (
	model: string,
	options?: {
		reasoningEffort?: string | null;
		safetyIdentifier?: string;
	},
) =>
	| {
			openai: {
				reasoningSummary?: "auto";
				reasoningEffort?: ReasoningEffort;
				safetyIdentifier?: string;
			};
	  }
	| undefined;
