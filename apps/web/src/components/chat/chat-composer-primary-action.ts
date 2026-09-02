export type ChatComposerPrimaryAction = "resume" | "send" | "stop";

export const resolveChatComposerPrimaryAction = ({
	canStop,
	hasInterruptedQueue,
	hasSendableInput,
}: {
	canStop: boolean;
	hasInterruptedQueue: boolean;
	hasSendableInput: boolean;
}): ChatComposerPrimaryAction => {
	if (canStop && !hasSendableInput) {
		return "stop";
	}

	if (!canStop && hasInterruptedQueue && !hasSendableInput) {
		return "resume";
	}

	return "send";
};
