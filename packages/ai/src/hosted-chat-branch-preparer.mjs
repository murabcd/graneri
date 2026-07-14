import { prepareHostedChatBranch } from "./hosted-chat-runtime.mjs";

export const getHostedInterruptedAssistantMessageIds = (runEvents) =>
	runEvents.flatMap((runEvent) =>
		runEvent.event.type === "assistant.message.interrupted"
			? [runEvent.event.assistantMessageId]
			: [],
	);

export const prepareHostedChatTurnBranch = async ({
	attachableRunId,
	chatId,
	continueRunId,
	getMessagesSnapshot,
	listRunEventsAfter,
	logLatency,
	message,
	messageId,
	messages = [],
	onBranchError,
	pendingMessages = [],
	prepareMessage,
	shouldLoadStoredMessages = true,
	storedMessagesForStatelessBranch = [],
	trigger,
	branchFromMessage,
	workspaceId,
}) => {
	const storedMessages = shouldLoadStoredMessages
		? await getMessagesSnapshot({ workspaceId, chatId })
		: [];
	const runEvents =
		shouldLoadStoredMessages &&
		continueRunId &&
		attachableRunId === continueRunId
			? await listRunEventsAfter({ runId: continueRunId, limit: 500 })
			: [];
	const interruptedAssistantMessageIds =
		getHostedInterruptedAssistantMessageIds(runEvents);
	logLatency?.("convex.messages_loaded", {
		messageCount: storedMessages.length,
	});
	const preparedMessage = prepareMessage
		? await prepareMessage({ message, storedMessages })
		: message;

	const branchStoredMessages = shouldLoadStoredMessages
		? storedMessages
		: storedMessagesForStatelessBranch;
	const preparedBranch = prepareHostedChatBranch({
		interruptedAssistantMessageIds,
		message: preparedMessage,
		messageId,
		messages,
		pendingMessages,
		storedMessages: branchStoredMessages,
		trigger,
	});
	const shouldCreateChatBranch = preparedBranch.shouldCreateChatBranch;

	if (shouldCreateChatBranch && preparedBranch.branchMessageId) {
		try {
			await branchFromMessage({
				workspaceId,
				chatId,
				messageId: preparedBranch.branchMessageId,
			});
		} catch (error) {
			const handled = await onBranchError?.({
				error,
				messageId: preparedBranch.branchMessageId,
			});
			if (handled) {
				return {
					ok: false,
					reason: "branch_error_handled",
				};
			}
			throw error;
		}
	}

	logLatency?.("chat.branch_ready", {
		incomingMessageCount: preparedBranch.incomingMessages.length,
		shouldCreateChatBranch,
	});

	return {
		ok: true,
		preparedBranch,
		shouldCreateChatBranch,
		storedMessages,
	};
};
