import { decodeStoredUiMessage } from "@workspace/ai/ui-message-codec";
import type { UIMessage } from "ai";

type TimestampedUIMessage = UIMessage & {
	createdAt?: Date | string | number;
};

export type StoredChatMessage = {
	id: string;
	role: "system" | "user" | "assistant";
	partsJson: string;
	metadataJson?: string;
	createdAt?: number;
};

export const toStoredChatMessages = (
	messages: StoredChatMessage[],
): UIMessage[] => messages.map(decodeStoredUiMessage);

export const getUIMessageSeedKey = (messages: UIMessage[]) =>
	messages
		.map((message) =>
			JSON.stringify({
				id: message.id,
				role: message.role,
				parts: message.parts,
				metadata: message.metadata,
				createdAt: (message as TimestampedUIMessage).createdAt,
			}),
		)
		.join("|");
