export const HOSTED_CHAT_CONTEXT_MESSAGE_LIMIT: 200;
export const HOSTED_CHAT_CONTEXT_COMPACTION_BATCH_SIZE: 100;

export type HostedChatContextMessage = {
	id: string;
	role: "system" | "user" | "assistant";
	partsJson: string;
	metadataJson?: string;
	createdAt: number;
	creationTime: number;
};
