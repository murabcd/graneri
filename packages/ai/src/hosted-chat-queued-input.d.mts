import type { UIMessage } from "ai";

type QueuedUserMessage<QueuedMessageId extends string> = {
	_id: QueuedMessageId;
	messageId: string;
	metadataJson?: string;
	text: string;
	claimVersion: number;
};

type QueuedMessageStatus = "paused" | "queued";

type ClaimedQueueLease<QueuedMessageId extends string> = {
	queuedMessageId: QueuedMessageId;
	claimVersion: number;
};

type ReplayClaimAttempt<QueuedMessageId extends string> =
	| {
			status: "claimed";
			claimedMessage: QueuedUserMessage<QueuedMessageId>;
	  }
	| { status: "active_run" | "unavailable" };

export declare const createHostedChatQueuedInput: <
	WorkspaceId extends string,
	ChatId extends string,
	RunId extends string,
	QueuedMessageId extends string,
>(args: {
	chatId: ChatId;
	claimForSteer: (args: {
		runId: RunId;
		queuedMessageId: QueuedMessageId;
	}) => Promise<QueuedUserMessage<QueuedMessageId>>;
	claimForReplay: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		expectedStatus: QueuedMessageStatus;
		queuedMessageId: QueuedMessageId;
	}) => Promise<ReplayClaimAttempt<QueuedMessageId>>;
	releaseClaimed: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		queuedMessageId: QueuedMessageId;
		claimVersion: number;
	}) => Promise<unknown>;
	workspaceId: WorkspaceId;
}) => {
	readonly claimedLease: ClaimedQueueLease<QueuedMessageId> | null;
	readonly hasClaimed: boolean;
	clearClaimed: () => void;
	claimSteer: (args: {
		queuedMessageId: QueuedMessageId;
		runId: RunId;
	}) => Promise<{
		claimedMessage: QueuedUserMessage<QueuedMessageId>;
		userMessage: UIMessage;
	}>;
	claimReplay: (args: {
		expectedStatus: QueuedMessageStatus;
		queuedMessageId: QueuedMessageId;
	}) => Promise<
		| { status: "claimed"; userMessage: UIMessage }
		| { status: "active_run" | "unavailable" }
	>;
	releaseClaimed: () => Promise<
		| {
				ok: true;
		  }
		| {
				error: unknown;
				ok: false;
				queuedMessageId: QueuedMessageId;
		  }
	>;
};
