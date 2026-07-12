import type { UIMessage } from "ai";
import {
	hasRenderableChatMessageText,
	mergePersistedChatMessagesWithController,
} from "./chat-message-state";

type RendererChatActiveRun = {
	assistantMessageId: string;
	interruptedAssistantMessageIds?: string[];
};

export const resolveRendererChatRunState = <
	ActiveRun extends RendererChatActiveRun,
>({
	activeRun,
	controllerMessages,
	isAiRequestPending,
	persistedMessages,
}: {
	activeRun: ActiveRun | null;
	controllerMessages: UIMessage[];
	isAiRequestPending: boolean;
	persistedMessages: UIMessage[];
}) => {
	const hasLocallyCompletedAssistantMessage =
		!isAiRequestPending &&
		Boolean(
			activeRun &&
				hasRenderableChatMessageText(
					controllerMessages.find(
						(message) =>
							message.id === activeRun.assistantMessageId &&
							message.role === "assistant",
					),
				),
		);
	const displayActiveRun = hasLocallyCompletedAssistantMessage
		? null
		: activeRun;

	if (!displayActiveRun) {
		return {
			activeAssistantMessageId: null,
			displayActiveRun,
			hasLocallyCompletedAssistantMessage,
		};
	}

	const controllerMessagesAfterLatestUser = controllerMessages.slice(
		controllerMessages.findLastIndex((message) => message.role === "user") + 1,
	);
	const persistedMessagesAfterLatestUser = persistedMessages.slice(
		persistedMessages.findLastIndex((message) => message.role === "user") + 1,
	);
	const activeControllerAssistantMessage = [
		...controllerMessagesAfterLatestUser,
	]
		.reverse()
		.find((message) => message.role === "assistant");
	const activePersistedAssistantMessage = [...persistedMessagesAfterLatestUser]
		.reverse()
		.find((message) => message.role === "assistant");

	return {
		activeAssistantMessageId:
			activeControllerAssistantMessage?.id ??
			activePersistedAssistantMessage?.id ??
			displayActiveRun.assistantMessageId,
		displayActiveRun,
		hasLocallyCompletedAssistantMessage,
	};
};

export const mergeRendererChatSessionMessages = ({
	activeAssistantMessageId,
	controllerMessages,
	displayActiveRun,
	persistedMessages,
}: {
	activeAssistantMessageId: string | null;
	controllerMessages: UIMessage[];
	displayActiveRun: RendererChatActiveRun | null;
	persistedMessages: UIMessage[];
}) => {
	if (!activeAssistantMessageId || !displayActiveRun) {
		return controllerMessages.length > 0
			? controllerMessages
			: persistedMessages;
	}

	const activeControllerMessage = controllerMessages.find(
		(message) =>
			message.id === activeAssistantMessageId && message.role === "assistant",
	);
	const activePersistedMessage = persistedMessages.find(
		(message) =>
			message.id === activeAssistantMessageId && message.role === "assistant",
	);
	const activeAssistantMessage = hasRenderableChatMessageText(
		activeControllerMessage,
	)
		? activeControllerMessage
		: activePersistedMessage;
	const interruptedAssistantMessageIds =
		displayActiveRun.interruptedAssistantMessageIds ?? [];

	return mergePersistedChatMessagesWithController({
		activeAssistantMessage,
		activeAssistantMessageId,
		controllerMessages,
		persistedQueuedMessagePosition:
			interruptedAssistantMessageIds.length > 0 &&
			!interruptedAssistantMessageIds.includes(activeAssistantMessageId)
				? "before-active"
				: "after-active",
		persistedMessages,
	});
};
