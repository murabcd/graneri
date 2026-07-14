import type { UIMessage } from "ai";
import type { createHostedChatQueuedInput } from "./hosted-chat-queued-input.mjs";
import type { createHostedChatTurnController } from "./hosted-chat-turn-controller.mjs";

type TurnInputValidationResult =
	| { ok: true }
	| { error: string; errorCode?: string; ok: false };

export declare const createHostedChatTurnInput: <
	WorkspaceId extends string,
	ChatId extends string,
	RunId extends string,
	QueuedMessageId extends string,
>(args: {
	attachableRun: {
		_id: RunId;
		status?: "running" | "waiting_for_user" | string;
	} | null;
	chatId: ChatId;
	claimReadyForRun: (args: {
		runId: RunId;
		queuedMessageId: QueuedMessageId;
	}) => Promise<
		{
			_id: QueuedMessageId;
			messageId: string;
			metadataJson?: string;
			text: string;
		}[]
	>;
	discardClaimed: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		queuedMessageId: QueuedMessageId;
	}) => Promise<unknown>;
	getClaimedForChat: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		queuedMessageId: QueuedMessageId;
	}) => Promise<{
		_id: QueuedMessageId;
		messageId: string;
		metadataJson?: string;
		text: string;
	} | null>;
	interruptActiveRun: (args: {
		chatId: ChatId;
		pendingInput: UIMessage[];
		runId: RunId;
		workspaceId: WorkspaceId;
	}) => Promise<unknown[]>;
	validateInput: (message: UIMessage) => TurnInputValidationResult;
	workspaceId: WorkspaceId;
}) => {
	queuedInput: ReturnType<
		typeof createHostedChatQueuedInput<
			WorkspaceId,
			ChatId,
			RunId,
			QueuedMessageId
		>
	>;
	turnController: ReturnType<
		typeof createHostedChatTurnController<
			WorkspaceId,
			ChatId,
			RunId,
			QueuedMessageId
		>
	>;
};
