import { projectUiMessagesForAssistantGeneration } from "./assistant-generation-context.mjs";
import { prepareHostedChatContextWindow } from "./hosted-chat-context-window.mjs";
import { buildHostedChatRunContext } from "./hosted-chat-run-context.mjs";
import { prepareHostedChatBranch } from "./hosted-chat-runtime.mjs";
import { validateUiMessages } from "./ui-message-codec.mjs";

const getInterruptedAssistantMessageIds = (runEvents) =>
	runEvents.flatMap((runEvent) =>
		runEvent.event.type === "assistant.message.interrupted" &&
		runEvent.event.assistantMessageId
			? [runEvent.event.assistantMessageId]
			: [],
	);

export const prepareHostedAssistantRunInput = async ({
	attachableRunId,
	branchFromMessage,
	chatId,
	contextWindow,
	continueRunId,
	getMessagesSnapshot,
	listRunEventsAfter,
	logLatency,
	message,
	messageId,
	onBranchError,
	pendingMessages = [],
	prepareMessage,
	trigger,
	workspaceId,
}) => {
	const runEventsPromise =
		continueRunId && attachableRunId === continueRunId
			? listRunEventsAfter({ runId: continueRunId, limit: 500 })
			: Promise.resolve([]);
	const shouldPrepareBranch = Boolean(
		messageId &&
			(trigger === "submit-message" || trigger === "regenerate-message"),
	);
	const prepareInputMessage = async (storedMessages) =>
		prepareMessage
			? await prepareMessage({ message, storedMessages })
			: message;
	let didCreateChatBranch = false;
	let preparedMessage = message;
	let interruptedAssistantMessageIds;

	if (shouldPrepareBranch) {
		const [storedMessages, runEvents] = await Promise.all([
			getMessagesSnapshot({ workspaceId, chatId, targetMessageId: messageId }),
			runEventsPromise,
		]);
		interruptedAssistantMessageIds =
			getInterruptedAssistantMessageIds(runEvents);
		logLatency?.("convex.messages_loaded", {
			messageCount: storedMessages.length,
		});
		preparedMessage = await prepareInputMessage(storedMessages);
		const branch = prepareHostedChatBranch({
			interruptedAssistantMessageIds,
			message: preparedMessage,
			messageId,
			pendingMessages,
			storedMessages,
			trigger,
		});

		if (branch.shouldCreateChatBranch && branch.branchMessageId) {
			try {
				await branchFromMessage({
					workspaceId,
					chatId,
					messageId: branch.branchMessageId,
				});
				didCreateChatBranch = true;
			} catch (error) {
				const handled = await onBranchError?.({
					error,
					messageId: branch.branchMessageId,
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
	}

	const [preparedContextWindow, runEvents] = await Promise.all([
		prepareHostedChatContextWindow(contextWindow),
		shouldPrepareBranch ? Promise.resolve(null) : runEventsPromise,
	]);
	logLatency?.("chat.context_prepared", {
		compactionCount: preparedContextWindow.compactionCount,
		messageCount: preparedContextWindow.messages.length,
	});
	if (!shouldPrepareBranch) {
		interruptedAssistantMessageIds =
			getInterruptedAssistantMessageIds(runEvents);
		logLatency?.("convex.messages_loaded", {
			messageCount: preparedContextWindow.messages.length,
		});
		preparedMessage = await prepareInputMessage(preparedContextWindow.messages);
	}

	const preparedBranch = prepareHostedChatBranch({
		interruptedAssistantMessageIds,
		message: preparedMessage,
		pendingMessages,
		storedMessages: preparedContextWindow.messages,
		trigger,
	});
	logLatency?.("chat.branch_ready", {
		incomingMessageCount: preparedBranch.incomingMessages.length,
		shouldCreateChatBranch: didCreateChatBranch,
	});

	return {
		ok: true,
		async complete(context) {
			const runContext = await buildHostedChatRunContext({
				...context,
				compactionSummary: preparedContextWindow.compactionSummary,
			});
			const generationMessages = projectUiMessagesForAssistantGeneration(
				preparedBranch.incomingMessages,
			);
			const chatMessages = await validateUiMessages({
				messages: generationMessages,
				tools: runContext.tools,
			});

			return { ...runContext, chatMessages, inputMessage: preparedMessage };
		},
	};
};
