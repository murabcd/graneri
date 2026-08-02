import type { StoredUiMessageRole } from "./ui-message-codec.mjs";

export const CHAT_CONTEXT_POLICY: Readonly<{
	exactTailMessageLimit: 200;
	compactionBatchSize: 100;
	maxCompactionRounds: 10;
}>;

export type HostedChatContextMessage = {
	id: string;
	role: StoredUiMessageRole;
	partsJson: string;
	metadataJson?: string;
	createdAt: number;
	creationTime: number;
};
