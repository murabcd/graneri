export const CHAT_MODE = Object.freeze({
	DEFAULT: "default",
	PLAN: "plan",
});

export const CHAT_MODES = Object.freeze([CHAT_MODE.DEFAULT, CHAT_MODE.PLAN]);

export const parseChatMode = (value) => {
	if (value === undefined) {
		return CHAT_MODE.DEFAULT;
	}

	return CHAT_MODES.find((chatMode) => chatMode === value) ?? null;
};

export const getChatModeInstructions = (chatMode) => {
	if (chatMode !== CHAT_MODE.PLAN) {
		return "";
	}

	return [
		"Plan mode is active.",
		"Explore the task and relevant context before proposing implementation.",
		"Use request_user_input for focused questions when a missing goal, constraint, tradeoff, or success criterion would materially change the plan. Do not ask unnecessary questions when the request is already well specified.",
		"Return a concrete, ordered plan that makes assumptions and verification steps explicit.",
		"Do not implement or mutate external state until the user explicitly asks to proceed beyond planning.",
	].join("\n");
};
