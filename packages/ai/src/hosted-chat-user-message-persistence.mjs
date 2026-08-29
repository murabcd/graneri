import {
	buildHostedChatSaveMessageArgs,
	getHostedChatReplayAcceptanceHeaders,
	getHostedChatSteerAcceptanceHeaders,
} from "./hosted-chat-runtime.mjs";

export const isHostedQueuedUserMessageAccept = ({
	continueRunId,
	queuedInput,
	replayQueuedMessageId,
}) =>
	Boolean(
		(continueRunId && queuedInput.hasClaimed) ||
			(replayQueuedMessageId && !continueRunId),
	);

const buildSaveMessageArgs = ({
	chatId,
	message,
	noteId,
	settings,
	workspaceId,
}) => ({
	...buildHostedChatSaveMessageArgs({
		workspaceId,
		chatId,
		noteId,
		message,
	}),
	settings,
});

export const persistHostedChatUserMessage = async ({
	acceptQueuedUserMessage,
	acceptSteeredUserMessages,
	chatId,
	continueRunId,
	message,
	nextAssistantMessageId,
	noteId,
	queuedInput,
	replayQueuedMessageId,
	saveMessage,
	settings,
	steeredUserMessages,
	workspaceId,
}) => {
	const saveMessageArgs = buildSaveMessageArgs({
		workspaceId,
		chatId,
		noteId,
		settings,
		message,
	});

	if (continueRunId && queuedInput.hasClaimed) {
		const acceptedQueuedMessageId = queuedInput.claimedQueuedMessageId;
		if (!acceptedQueuedMessageId) {
			throw new Error("Claimed steered queued message is missing.");
		}

		await acceptSteeredUserMessages({
			workspaceId: saveMessageArgs.workspaceId,
			chatId: saveMessageArgs.chatId,
			noteId: saveMessageArgs.noteId,
			title: saveMessageArgs.title,
			preview: saveMessageArgs.preview,
			settings: saveMessageArgs.settings,
			runId: continueRunId,
			nextAssistantMessageId,
			messages: steeredUserMessages.map((steeredMessage, index) => ({
				queuedMessageId: queuedInput.claimedQueuedMessageIds[index],
				message: buildSaveMessageArgs({
					workspaceId,
					chatId,
					noteId,
					settings,
					message: steeredMessage,
				}).message,
			})),
		});

		const acceptedHeaders = getHostedChatSteerAcceptanceHeaders({
			queuedMessageId: acceptedQueuedMessageId,
			queuedMessageIds: queuedInput.claimedQueuedMessageIds,
			turnId: continueRunId,
		});
		queuedInput.clearClaimed();
		return {
			acceptedSteerTurnId: continueRunId,
			pendingQueuedAcceptanceHeaders: acceptedHeaders,
		};
	}

	if (replayQueuedMessageId && !continueRunId) {
		await acceptQueuedUserMessage({
			...saveMessageArgs,
			queuedMessageId: replayQueuedMessageId,
		});
		return {
			acceptedSteerTurnId: null,
			pendingQueuedAcceptanceHeaders: getHostedChatReplayAcceptanceHeaders({
				queuedMessageId: replayQueuedMessageId,
			}),
		};
	}

	if (continueRunId) {
		throw new Error("Continued user input must use a claimed queue item.");
	}

	await saveMessage(saveMessageArgs);

	return {
		acceptedSteerTurnId: null,
		pendingQueuedAcceptanceHeaders: null,
	};
};
