import type { UIMessage } from "ai";
import type { createHostedChatQueuedInput } from "./hosted-chat-queued-input.mjs";
import type { HostedChatTurnIntent } from "./hosted-chat-runtime.mjs";

type AttachableRun<RunId extends string> = {
	_id: RunId;
	assistantMessageId: string;
	producer: "convex" | "web";
	status?: "running" | "waiting_for_user" | string;
} | null;

type QueuedInput<
	WorkspaceId extends string,
	ChatId extends string,
	RunId extends string,
	QueuedMessageId extends string,
> = ReturnType<
	typeof createHostedChatQueuedInput<
		WorkspaceId,
		ChatId,
		RunId,
		QueuedMessageId
	>
>;

type TurnInputValidationResult =
	| {
			ok: true;
	  }
	| {
			error: string;
			errorCode?: string;
			ok: false;
	  };

type TurnControllerError = {
	cause?: unknown;
	releaseError?: unknown;
	error: string;
	errorCode?: string;
	logMessage?: string;
	ok: false;
	phase:
		| "active_run_mismatch"
		| "input_invalid"
		| "message_missing"
		| "replay_claim_conflict"
		| "steer_queue_release_failed";
	statusCode: 400 | 409 | 500;
};

type ReleaseClaimedResult<QueuedMessageId extends string> =
	| {
			ok: true;
	  }
	| {
			error: unknown;
			ok: false;
			queuedMessageId?: QueuedMessageId;
	  };

type PreparedTurnInput<QueuedMessageId extends string> = {
	releaseClaimedQueuedMessage: () => Promise<
		ReleaseClaimedResult<QueuedMessageId>
	>;
	effectiveMessage: UIMessage;
	ok: true;
	replayedUserMessage: UIMessage | null;
	steeredUserMessage: UIMessage | null;
};

export declare const createHostedChatTurnController: <
	WorkspaceId extends string,
	ChatId extends string,
	RunId extends string,
	QueuedMessageId extends string,
>(args: {
	attachableRun: AttachableRun<RunId>;
	queuedInput: QueuedInput<WorkspaceId, ChatId, RunId, QueuedMessageId>;
	validateInput: (message: UIMessage) => TurnInputValidationResult;
}) => {
	releaseClaimedQueuedMessage: () => Promise<
		ReleaseClaimedResult<QueuedMessageId>
	>;
	prepareInput: (args: {
		message?: UIMessage | null;
		turnIntent: HostedChatTurnIntent<RunId, QueuedMessageId>;
	}) => Promise<PreparedTurnInput<QueuedMessageId> | TurnControllerError>;
	requireSameActiveRun: (args: { continueRunId?: RunId | null }) => Promise<
		| {
				ok: true;
		  }
		| TurnControllerError
	>;
};
