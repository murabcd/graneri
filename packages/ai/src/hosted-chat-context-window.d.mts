import type { HostedChatContextMessage } from "./chat-context-contract.mjs";

export {
	HOSTED_CHAT_CONTEXT_COMPACTION_BATCH_SIZE,
	HOSTED_CHAT_CONTEXT_MESSAGE_LIMIT,
	type HostedChatContextMessage,
} from "./chat-context-contract.mjs";

export type HostedChatContextCompaction = {
	summary: string;
	throughCreationTime: number;
	throughMessageId: string;
	updatedAt: number;
};

export type HostedChatStoredContextMessage = Omit<
	HostedChatContextMessage,
	"creationTime"
>;

export type HostedChatContextPreparationState = {
	compaction: HostedChatContextCompaction | null;
	hasMoreMessages: boolean;
	messages: HostedChatContextMessage[];
};

export function buildHostedChatCompactionTranscript(
	messages: HostedChatContextMessage[],
): string;

export function generateHostedChatContextSummary(args: {
	messages: HostedChatContextMessage[];
	previousSummary: string;
	safetyIdentifier: string;
}): Promise<string>;

export function prepareHostedChatContextWindow(args: {
	compactionLifecycle: {
		start: () => Promise<unknown>;
		cancel: () => Promise<unknown>;
	};
	loadState: () => Promise<HostedChatContextPreparationState>;
	safetyIdentifier: string;
	saveCompaction: (args: {
		expectedThroughCreationTime?: number;
		expectedThroughMessageId?: string;
		summary: string;
		throughCreationTime: number;
		throughMessageId: string;
	}) => Promise<HostedChatContextPreparationState>;
	summarize?: typeof generateHostedChatContextSummary;
}): Promise<{
	compactionCount: number;
	compactionSummary: string | null;
	messages: HostedChatStoredContextMessage[];
}>;
