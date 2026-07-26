const GPT_5_6_SOL_MODEL_ID = "gpt-5.6-sol";
const GPT_5_6_TERRA_MODEL_ID = "gpt-5.6-terra";
const GPT_5_6_LUNA_MODEL_ID = "gpt-5.6-luna";

export const CHAT_MODELS = Object.freeze([
	{
		id: GPT_5_6_SOL_MODEL_ID,
		name: "GPT-5.6 Sol",
		model: GPT_5_6_SOL_MODEL_ID,
	},
	{
		id: GPT_5_6_TERRA_MODEL_ID,
		name: "GPT-5.6 Terra",
		model: GPT_5_6_TERRA_MODEL_ID,
	},
	{
		id: GPT_5_6_LUNA_MODEL_ID,
		name: "GPT-5.6 Luna",
		model: GPT_5_6_LUNA_MODEL_ID,
	},
]);

export const DEFAULT_CHAT_MODEL_ID = GPT_5_6_SOL_MODEL_ID;
export const NOTE_GENERATION_MODEL_ID = GPT_5_6_TERRA_MODEL_ID;
export const CHAT_TITLE_MODEL_ID = GPT_5_6_LUNA_MODEL_ID;
export const CONTEXT_COMPACTION_MODEL_ID = GPT_5_6_LUNA_MODEL_ID;
export const AUTOMATION_DELIVERY_MODEL_ID = GPT_5_6_LUNA_MODEL_ID;

export const defaultChatModel = CHAT_MODELS.find(
	(model) => model.id === DEFAULT_CHAT_MODEL_ID,
);

if (!defaultChatModel) {
	throw new Error(
		`Default chat model "${DEFAULT_CHAT_MODEL_ID}" is not configured.`,
	);
}

export const findChatModel = (value) =>
	CHAT_MODELS.find((model) => model.id === value || model.model === value);

export const getChatModel = (value) => {
	const model = findChatModel(value);

	if (!model) {
		throw new Error(`Unsupported chat model: ${value}`);
	}

	return model;
};

export const isSupportedChatModel = (value) => Boolean(findChatModel(value));

export const REASONING_EFFORTS = Object.freeze([
	{ id: "low", name: "Light" },
	{ id: "medium", name: "Medium" },
	{ id: "high", name: "High" },
	{ id: "xhigh", name: "Extra High" },
]);

export const DEFAULT_REASONING_EFFORT = "medium";

export const findReasoningEffort = (value) =>
	REASONING_EFFORTS.find((effort) => effort.id === value);

export const normalizeReasoningEffort = (value) =>
	findReasoningEffort(value)?.id ?? DEFAULT_REASONING_EFFORT;

const normalizeOpenAiReasoningEffort = (value) =>
	value === "none" ? value : normalizeReasoningEffort(value);

export const getOpenAiModelProviderOptions = (
	model,
	{ reasoningEffort, safetyIdentifier } = {},
) => {
	const isReasoningModel = model?.startsWith("gpt-5");
	if (!isReasoningModel && !safetyIdentifier) {
		return undefined;
	}
	const normalizedReasoningEffort = isReasoningModel
		? normalizeOpenAiReasoningEffort(reasoningEffort)
		: undefined;

	return {
		openai: {
			...(isReasoningModel
				? {
						...(normalizedReasoningEffort === "none"
							? {}
							: { reasoningSummary: "auto" }),
						reasoningEffort: normalizedReasoningEffort,
					}
				: {}),
			...(safetyIdentifier ? { safetyIdentifier } : {}),
		},
	};
};
