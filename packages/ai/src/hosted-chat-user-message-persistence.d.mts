import type { UIMessage } from "ai";
import type { ChatSettings } from "./chat-settings.mjs";
import type { createHostedChatQueuedInput } from "./hosted-chat-queued-input.mjs";
import type {
	HostedChatTurnIntent,
	toHostedStoredMessage,
} from "./hosted-chat-runtime.mjs";

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

type SaveMessageArgs<
	WorkspaceId extends string,
	ChatId extends string,
	NoteId extends string,
	ProjectId extends string,
> = {
	chatId: ChatId;
	message: UIMessage;
	noteId: NoteId | null;
	projectId: ProjectId | null;
	settings: ChatSettings;
	workspaceId: WorkspaceId;
};

type BuiltSaveMessageArgs<
	WorkspaceId extends string,
	ChatId extends string,
	NoteId extends string,
	ProjectId extends string,
> = {
	chatId: ChatId;
	message: ReturnType<typeof toHostedStoredMessage>;
	noteId: NoteId | undefined;
	projectId: ProjectId | null;
	preview: string;
	settings: ChatSettings;
	title?: string;
	workspaceId: WorkspaceId;
};

export declare const persistHostedChatUserMessage: <
	WorkspaceId extends string,
	ChatId extends string,
	NoteId extends string,
	ProjectId extends string,
	RunId extends string,
	QueuedMessageId extends string,
	QueuedReplayRun,
>(
	args: SaveMessageArgs<WorkspaceId, ChatId, NoteId, ProjectId> & {
		acceptQueuedUserMessageAndStartRun: (
			args: BuiltSaveMessageArgs<WorkspaceId, ChatId, NoteId, ProjectId> & {
				queuedMessageId: QueuedMessageId;
				claimVersion: number;
			},
		) => Promise<QueuedReplayRun>;
		acceptSteeredUserMessage: (args: {
			workspaceId: WorkspaceId;
			chatId: ChatId;
			noteId: NoteId | undefined;
			projectId: ProjectId | null;
			title?: string;
			preview: string;
			settings: ChatSettings;
			runId: RunId;
			queuedMessageId: QueuedMessageId;
			claimVersion: number;
			message: ReturnType<typeof toHostedStoredMessage>;
		}) => Promise<unknown>;
		queuedInput: QueuedInput<WorkspaceId, ChatId, RunId, QueuedMessageId>;
		saveMessage: (
			args: BuiltSaveMessageArgs<WorkspaceId, ChatId, NoteId, ProjectId>,
		) => Promise<unknown>;
		turnIntent: HostedChatTurnIntent<RunId, QueuedMessageId>;
	},
) => Promise<
	| {
			type: "direct";
	  }
	| {
			type: "replay";
			acceptance: QueuedReplayRun;
			queuedMessageId: QueuedMessageId;
	  }
	| {
			type: "steer";
			queuedMessageId: QueuedMessageId;
			runId: RunId;
	  }
>;
