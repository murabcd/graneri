import { createHostedChatQueuedInput } from "./hosted-chat-queued-input.mjs";
import { createHostedChatTurnController } from "./hosted-chat-turn-controller.mjs";

export const createHostedChatTurnInput = ({
	attachableRun,
	chatId,
	claimReadyForRun,
	discardClaimed,
	getClaimedForChat,
	interruptActiveRun,
	validateInput,
	workspaceId,
}) => {
	const queuedInput = createHostedChatQueuedInput({
		chatId,
		claimReadyForRun,
		discardClaimed,
		getClaimedForChat,
		workspaceId,
	});
	const turnController = createHostedChatTurnController({
		attachableRun,
		chatId,
		interruptActiveRun,
		queuedInput,
		validateInput,
		workspaceId,
	});

	return { queuedInput, turnController };
};
