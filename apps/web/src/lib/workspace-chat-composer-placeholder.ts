import { CHAT_MODE, type ChatMode } from "@workspace/ai/chat-mode";

export const resolveWorkspaceChatComposerPlaceholder = ({
	chatMode,
	hasMessages,
	hasStoredChat,
}: {
	chatMode: ChatMode;
	hasMessages: boolean;
	hasStoredChat: boolean;
}) => {
	if (chatMode === CHAT_MODE.PLAN) {
		return "Describe your task to generate a plan...";
	}

	return hasStoredChat || hasMessages
		? "Ask for follow-up"
		: "Ask anything. @ to use recipes, tools, or notes";
};
