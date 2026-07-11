export const CHAT_MODELS = Object.freeze([
	{
		id: "gpt-5.4",
		name: "GPT-5.4",
		model: "gpt-5.4",
	},
	{
		id: "gpt-5.4-mini",
		name: "GPT-5.4 mini",
		model: "gpt-5.4-mini",
	},
	{
		id: "gpt-5.4-nano",
		name: "GPT-5.4 nano",
		model: "gpt-5.4-nano",
	},
]);

export const DEFAULT_CHAT_MODEL_ID = "gpt-5.4";
export const CHAT_TITLE_MODEL_ID = "gpt-5.4-nano";
export const NOTE_CHAT_MODEL_ID = "gpt-5.4-mini";
export const NOTE_GENERATION_MODEL_ID = "gpt-5.4-mini";

export const CHAT_SERVER_MODELS = Object.freeze([
	{
		id: "auto",
		name: "Auto",
		model: DEFAULT_CHAT_MODEL_ID,
	},
	...CHAT_MODELS,
]);

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
	{ id: "low", name: "Low" },
	{ id: "medium", name: "Medium" },
	{ id: "high", name: "High" },
	{ id: "xhigh", name: "Extra High" },
]);

export const DEFAULT_REASONING_EFFORT = "medium";

export const findReasoningEffort = (value) =>
	REASONING_EFFORTS.find((effort) => effort.id === value);

export const normalizeReasoningEffort = (value) =>
	findReasoningEffort(value)?.id ?? DEFAULT_REASONING_EFFORT;

export const getChatModelProviderOptions = (
	model,
	{ reasoningEffort, safetyIdentifier } = {},
) => {
	const isReasoningModel = model?.startsWith("gpt-5");
	if (!isReasoningModel && !safetyIdentifier) {
		return undefined;
	}

	return {
		openai: {
			...(isReasoningModel
				? {
						reasoningSummary: "auto",
						reasoningEffort: normalizeReasoningEffort(reasoningEffort),
					}
				: {}),
			...(safetyIdentifier ? { safetyIdentifier } : {}),
		},
	};
};
