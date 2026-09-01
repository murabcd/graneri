import { buildHostedChatSaveMessageArgs } from "./hosted-chat-runtime.mjs";

const buildSaveMessageArgs = ({
	chatId,
	message,
	noteId,
	projectId,
	settings,
	workspaceId,
}) => ({
	...buildHostedChatSaveMessageArgs({
		workspaceId,
		chatId,
		noteId,
		message,
	}),
	projectId,
	settings,
});

export const persistHostedChatUserMessage = async ({
	acceptQueuedUserMessageAndStartRun,
	acceptSteeredUserMessage,
	chatId,
	message,
	noteId,
	projectId,
	queuedInput,
	saveMessage,
	settings,
	turnIntent,
	workspaceId,
}) => {
	const saveMessageArgs = buildSaveMessageArgs({
		workspaceId,
		chatId,
		noteId,
		projectId,
		settings,
		message,
	});

	if (turnIntent.type === "steer") {
		const acceptedLease = queuedInput.claimedLease;
		if (
			!acceptedLease ||
			acceptedLease.queuedMessageId !== turnIntent.queuedMessageId
		) {
			throw new Error("Claimed steered queued message is missing.");
		}

		await acceptSteeredUserMessage({
			workspaceId: saveMessageArgs.workspaceId,
			chatId: saveMessageArgs.chatId,
			noteId: saveMessageArgs.noteId,
			projectId: saveMessageArgs.projectId,
			title: saveMessageArgs.title,
			preview: saveMessageArgs.preview,
			settings: saveMessageArgs.settings,
			runId: turnIntent.runId,
			queuedMessageId: acceptedLease.queuedMessageId,
			claimVersion: acceptedLease.claimVersion,
			message: buildSaveMessageArgs({
				workspaceId,
				chatId,
				noteId,
				projectId,
				settings,
				message,
			}).message,
		});

		queuedInput.clearClaimed();
		return {
			type: "steer",
			queuedMessageId: acceptedLease.queuedMessageId,
			runId: turnIntent.runId,
		};
	}

	if (turnIntent.type === "replay") {
		const acceptedLease = queuedInput.claimedLease;
		if (
			!acceptedLease ||
			acceptedLease.queuedMessageId !== turnIntent.queuedMessageId
		) {
			throw new Error("Claimed replay queued message is missing.");
		}
		const acceptedReplayRun = await acceptQueuedUserMessageAndStartRun({
			...saveMessageArgs,
			queuedMessageId: turnIntent.queuedMessageId,
			claimVersion: acceptedLease.claimVersion,
		});
		queuedInput.clearClaimed();
		return {
			type: "replay",
			acceptance: acceptedReplayRun,
			queuedMessageId: turnIntent.queuedMessageId,
		};
	}

	if (turnIntent.continueRunId) {
		throw new Error("Continued user input must use a claimed queue item.");
	}

	await saveMessage(saveMessageArgs);

	return {
		type: "direct",
	};
};
