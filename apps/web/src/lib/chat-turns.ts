import type { UIMessage } from "ai";

type ChatTurn = [UIMessage, ...UIMessage[]];

export const groupMessagesIntoTurns = (messages: UIMessage[]) => {
	const turns: ChatTurn[] = [];
	let currentTurn: ChatTurn | null = null;

	for (const message of messages) {
		if (message.role === "user") {
			if (currentTurn) {
				turns.push(currentTurn);
			}
			currentTurn = [message];
			continue;
		}

		if (message.role === "assistant") {
			if (!currentTurn) {
				currentTurn = [message];
				continue;
			}
			currentTurn.push(message);
		}
	}

	if (currentTurn) {
		turns.push(currentTurn);
	}

	return turns;
};

export const getLastAssistantHasRenderableContent = (
	messages: UIMessage[],
	hasRenderableContent: (message: UIMessage) => boolean,
) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];

		if (message?.role !== "assistant") {
			continue;
		}

		return hasRenderableContent(message);
	}

	return false;
};
