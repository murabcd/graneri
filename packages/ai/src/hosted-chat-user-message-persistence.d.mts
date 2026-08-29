import type { UIMessage } from "ai";
import type { ChatSettings } from "./chat-settings.mjs";
import type { createHostedChatQueuedInput } from "./hosted-chat-queued-input.mjs";
import type { toHostedStoredMessage } from "./hosted-chat-runtime.mjs";

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

export declare const isHostedQueuedUserMessageAccept: <
	RunId extends string,
	QueuedMessageId extends string,
>(args: {
	continueRunId?: RunId | null;
	queuedInput: { readonly hasClaimed: boolean };
	replayQueuedMessageId?: QueuedMessageId | null;
}) => boolean;

export declare const persistHostedChatUserMessage: <
	WorkspaceId extends string,
	ChatId extends string,
	NoteId extends string,
	ProjectId extends string,
	RunId extends string,
	QueuedMessageId extends string,
>(
	args: SaveMessageArgs<WorkspaceId, ChatId, NoteId, ProjectId> & {
		acceptQueuedUserMessage: (
			args: BuiltSaveMessageArgs<WorkspaceId, ChatId, NoteId, ProjectId> & {
				queuedMessageId: QueuedMessageId;
			},
		) => Promise<unknown>;
		acceptSteeredUserMessages: (args: {
			workspaceId: WorkspaceId;
			chatId: ChatId;
			noteId: NoteId | undefined;
			projectId: ProjectId | null;
			title?: string;
			preview: string;
			nextAssistantMessageId: string;
			settings: ChatSettings;
			runId: RunId;
			messages: Array<{
				queuedMessageId: QueuedMessageId;
				message: ReturnType<typeof toHostedStoredMessage>;
			}>;
		}) => Promise<unknown>;
		continueRunId?: RunId | null;
		nextAssistantMessageId: string;
		queuedInput: QueuedInput<WorkspaceId, ChatId, RunId, QueuedMessageId>;
		replayQueuedMessageId?: QueuedMessageId | null;
		saveMessage: (
			args: BuiltSaveMessageArgs<WorkspaceId, ChatId, NoteId, ProjectId>,
		) => Promise<unknown>;
		steeredUserMessages: UIMessage[];
	},
) => Promise<{
	acceptedSteerTurnId: RunId | null;
	pendingQueuedAcceptanceHeaders: Record<string, string> | null;
}>;
