import { createHostedChatQueuedInput } from "./hosted-chat-queued-input.mjs";
import { createHostedChatTurnController } from "./hosted-chat-turn-controller.mjs";

export const createHostedChatTurnInput = ({
	attachableRun,
	chatId,
	claimForReplay,
	claimForSteer,
	releaseClaimed,
	validateInput,
	workspaceId,
}) => {
	const queuedInput = createHostedChatQueuedInput({
		chatId,
		claimForReplay,
		claimForSteer,
		releaseClaimed,
		workspaceId,
	});
	const turnController = createHostedChatTurnController({
		attachableRun,
		queuedInput,
		validateInput,
	});

	return { queuedInput, turnController };
};
