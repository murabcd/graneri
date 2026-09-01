import type { UIMessage } from "ai";

export declare const projectUiMessagesForAssistantGeneration: <
	Message extends UIMessage,
>(
	messages: readonly Message[],
) => Message[];
