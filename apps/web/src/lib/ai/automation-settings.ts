import {
	type ChatModel,
	DEFAULT_REASONING_EFFORT,
	DEFAULT_SERVICE_TIER,
	defaultChatModel,
	findChatModel,
	findReasoningEffort,
	findServiceTier,
	type ReasoningEffort,
	type ServiceTier,
} from "@/lib/ai/models";

const AUTOMATION_MODEL_STORAGE_KEY = "graneri:automation-model";
const AUTOMATION_REASONING_EFFORT_STORAGE_KEY =
	"graneri:automation-reasoning-effort";
const AUTOMATION_SERVICE_TIER_STORAGE_KEY = "graneri:automation-service-tier";

export const getStoredAutomationModel = () => {
	if (typeof window === "undefined") {
		return defaultChatModel;
	}

	return (
		findChatModel(window.localStorage.getItem(AUTOMATION_MODEL_STORAGE_KEY)) ??
		defaultChatModel
	);
};

export const storeAutomationModel = (model: ChatModel) => {
	window.localStorage.setItem(AUTOMATION_MODEL_STORAGE_KEY, model.model);
};

export const getStoredAutomationReasoningEffort = (): ReasoningEffort => {
	if (typeof window === "undefined") {
		return DEFAULT_REASONING_EFFORT;
	}

	return (
		findReasoningEffort(
			window.localStorage.getItem(AUTOMATION_REASONING_EFFORT_STORAGE_KEY),
		)?.id ?? DEFAULT_REASONING_EFFORT
	);
};

export const storeAutomationReasoningEffort = (value: ReasoningEffort) => {
	window.localStorage.setItem(AUTOMATION_REASONING_EFFORT_STORAGE_KEY, value);
};

export const getStoredAutomationServiceTier = (): ServiceTier => {
	if (typeof window === "undefined") {
		return DEFAULT_SERVICE_TIER;
	}

	return (
		findServiceTier(
			window.localStorage.getItem(AUTOMATION_SERVICE_TIER_STORAGE_KEY),
		)?.id ?? DEFAULT_SERVICE_TIER
	);
};

export const storeAutomationServiceTier = (value: ServiceTier) => {
	window.localStorage.setItem(AUTOMATION_SERVICE_TIER_STORAGE_KEY, value);
};
