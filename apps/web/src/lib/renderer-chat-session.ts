import {
	HOSTED_REQUEST_USER_INPUT_TOOL_NAME,
	type HostedUserQuestionPendingDecision,
} from "@workspace/ai/hosted-user-question";
import type { UIMessage } from "ai";
import {
	isToolUIPart,
	lastAssistantMessageIsCompleteWithApprovalResponses,
	lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import type { AttachableAssistantRun } from "@/lib/attachable-assistant-run";
import {
	hasRenderableChatMessageText,
	mergePersistedChatMessagesWithController,
} from "./chat-message-state";

type RendererChatActiveRun = Pick<
	AttachableAssistantRun,
	"assistantMessageId" | "interruptedAssistantMessageIds"
>;

const hasHostedUserQuestionOutput = (messages: UIMessage[]) =>
	messages
		.at(-1)
		?.parts.some(
			(part) =>
				isToolUIPart(part) &&
				part.type === `tool-${HOSTED_REQUEST_USER_INPUT_TOOL_NAME}` &&
				(part.state === "output-available" || part.state === "output-error"),
		) ?? false;

const hasLocallyResolvedToolInteraction = (message?: UIMessage) =>
	message?.parts.some(
		(part) =>
			isToolUIPart(part) &&
			(part.state === "approval-responded" ||
				part.state === "output-available" ||
				part.state === "output-error"),
	) ?? false;

export const prepareRendererUserQuestionMessages = ({
	decision,
	messages,
}: {
	decision: Pick<
		HostedUserQuestionPendingDecision,
		"assistantMessageId" | "toolCallId"
	>;
	messages: UIMessage[];
}) => {
	const assistantMessageIndex = messages.findIndex(
		(message) =>
			message.id === decision.assistantMessageId &&
			message.role === "assistant",
	);
	const assistantMessage = messages[assistantMessageIndex];
	const hasMatchingQuestion = assistantMessage?.parts.some(
		(part) =>
			isToolUIPart(part) &&
			part.type === `tool-${HOSTED_REQUEST_USER_INPUT_TOOL_NAME}` &&
			part.toolCallId === decision.toolCallId &&
			part.state === "input-available",
	);

	if (assistantMessageIndex < 0 || !hasMatchingQuestion) {
		throw new Error(
			"The pending questionnaire message is no longer available.",
		);
	}

	return messages.slice(0, assistantMessageIndex + 1);
};

export const shouldAutomaticallyContinueRendererChat = (args: {
	messages: UIMessage[];
}) =>
	lastAssistantMessageIsCompleteWithApprovalResponses(args) ||
	(!hasHostedUserQuestionOutput(args.messages) &&
		lastAssistantMessageIsCompleteWithToolCalls(args));

export const resolveActiveAssistantMessageId = ({
	activeRun,
	controllerMessages,
	persistedMessages,
}: {
	activeRun: RendererChatActiveRun | null;
	controllerMessages: UIMessage[];
	persistedMessages: UIMessage[];
}) => {
	if (!activeRun) return null;

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

	return (
		activeControllerAssistantMessage?.id ??
		activePersistedAssistantMessage?.id ??
		activeRun.assistantMessageId
	);
};

export const mergeRendererChatSessionMessages = ({
	activeAssistantMessageId,
	controllerMessages,
	activeRun,
	persistedMessages,
}: {
	activeAssistantMessageId: string | null;
	controllerMessages: UIMessage[];
	activeRun: RendererChatActiveRun | null;
	persistedMessages: UIMessage[];
}) => {
	if (!activeAssistantMessageId || !activeRun) {
		const controllerMessageById = new Map(
			controllerMessages.map((message) => [message.id, message]),
		);
		const persistedMessagesWithControllerSnapshots = persistedMessages.map(
			(message) => controllerMessageById.get(message.id) ?? message,
		);

		return mergePersistedChatMessagesWithController({
			controllerMessages,
			persistedMessages: persistedMessagesWithControllerSnapshots,
		});
	}

	const activeControllerMessage = controllerMessages.find(
		(message) =>
			message.id === activeAssistantMessageId && message.role === "assistant",
	);
	const activePersistedMessage = persistedMessages.find(
		(message) =>
			message.id === activeAssistantMessageId && message.role === "assistant",
	);
	const activeAssistantMessage =
		hasRenderableChatMessageText(activeControllerMessage) ||
		hasLocallyResolvedToolInteraction(activeControllerMessage)
			? activeControllerMessage
			: activePersistedMessage;
	const interruptedAssistantMessageIds =
		activeRun.interruptedAssistantMessageIds ?? [];

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
