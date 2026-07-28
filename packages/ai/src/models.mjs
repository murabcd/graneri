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
export const PROJECT_DESCRIPTION_MODEL_ID = GPT_5_6_TERRA_MODEL_ID;
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

export const SERVICE_TIERS = Object.freeze([
	{ id: "auto", name: "Standard" },
	{ id: "priority", name: "Fast" },
]);

export const DEFAULT_SERVICE_TIER = "auto";

export const findServiceTier = (value) =>
	SERVICE_TIERS.find((tier) => tier.id === value);

export const normalizeServiceTier = (value) =>
	findServiceTier(value)?.id ?? DEFAULT_SERVICE_TIER;

const normalizeOpenAiReasoningEffort = (value) =>
	value === "none" ? value : normalizeReasoningEffort(value);

export const getOpenAiModelProviderOptions = (
	model,
	{ reasoningEffort, safetyIdentifier, serviceTier } = {},
) => {
	const isReasoningModel = model?.startsWith("gpt-5");
	const normalizedServiceTier = normalizeServiceTier(serviceTier);
	if (
		!isReasoningModel &&
		!safetyIdentifier &&
		normalizedServiceTier === DEFAULT_SERVICE_TIER
	) {
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
			...(normalizedServiceTier === DEFAULT_SERVICE_TIER
				? {}
				: { serviceTier: normalizedServiceTier }),
			...(safetyIdentifier ? { safetyIdentifier } : {}),
		},
	};
};
