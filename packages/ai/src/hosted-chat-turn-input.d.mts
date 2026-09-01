import type { UIMessage } from "ai";
import type { createHostedChatQueuedInput } from "./hosted-chat-queued-input.mjs";
import type { createHostedChatTurnController } from "./hosted-chat-turn-controller.mjs";

type TurnInputValidationResult =
	| { ok: true }
	| { error: string; errorCode?: string; ok: false };

type QueuedMessageStatus = "paused" | "queued";

export declare const createHostedChatTurnInput: <
	WorkspaceId extends string,
	ChatId extends string,
	RunId extends string,
	QueuedMessageId extends string,
>(args: {
	attachableRun: {
		_id: RunId;
		assistantMessageId: string;
		producer: "convex" | "web";
		status?: "running" | "waiting_for_user" | string;
	} | null;
	chatId: ChatId;
	claimForSteer: (args: {
		runId: RunId;
		queuedMessageId: QueuedMessageId;
	}) => Promise<{
		_id: QueuedMessageId;
		messageId: string;
		metadataJson?: string;
		text: string;
		claimVersion: number;
	}>;
	claimForReplay: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		expectedStatus: QueuedMessageStatus;
		queuedMessageId: QueuedMessageId;
	}) => Promise<
		| {
				status: "claimed";
				claimedMessage: {
					_id: QueuedMessageId;
					messageId: string;
					metadataJson?: string;
					text: string;
					claimVersion: number;
				};
		  }
		| { status: "active_run" | "unavailable" }
	>;
	releaseClaimed: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		queuedMessageId: QueuedMessageId;
		claimVersion: number;
	}) => Promise<unknown>;
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
