import type { UIMessage } from "ai";
import type * as HostedChatRuntime from "./hosted-chat-runtime.mjs";
import type { HostedHumanDecisionPendingDecision } from "./hosted-human-decision.mjs";

type CompletedAssistantRunTerminalization = {
	responseMessage: UIMessage;
	status: "completed";
};

type FailedAssistantRunTerminalization = {
	errorText: string;
	status: "failed";
};

type WaitingAssistantRunTerminalization = {
	pendingDecision: HostedHumanDecisionPendingDecision;
	responseMessage: UIMessage;
	status: "waiting_for_user";
};

export type HostedAssistantRunTerminalization =
	| CompletedAssistantRunTerminalization
	| WaitingAssistantRunTerminalization
	| FailedAssistantRunTerminalization;

type HostedActiveStreamSessionLike = {
	abortSignal: AbortSignal;
	cleanup: () => void;
	closePersistence: () => Promise<void>;
	persister: {
		readonly messageId: string;
	};
};

type LogLatencyDetails = Record<
	string,
	boolean | null | number | string | undefined
>;

type SaveAssistantMessageForRunArgs<
	WorkspaceId extends string,
	NoteId extends string,
	AssistantRunId extends string,
> = ReturnType<
	typeof HostedChatRuntime.buildHostedChatSaveMessageArgs<WorkspaceId, NoteId>
> & {
	runId: AssistantRunId;
	assistantMessageId: string;
};

export declare const createHostedAssistantRunFinalizer: <
	WorkspaceId extends string,
	NoteId extends string,
	AssistantRunId extends string,
>(args: {
	activeStreamSession: HostedActiveStreamSessionLike;
	assistantRunId: AssistantRunId;
	chatId: string;
	failAssistantRun: (args: {
		errorText: string;
		runId: AssistantRunId;
		assistantMessageId: string;
	}) => Promise<unknown>;
	finishAssistantRun: (args: {
		runId: AssistantRunId;
		assistantMessageId: string;
	}) => Promise<unknown>;
	lastUserMessage?: UIMessage | null;
	logError: (args: {
		error: unknown;
		terminalization: HostedAssistantRunTerminalization;
	}) => void;
	logLatency: (stage: string, details?: LogLatencyDetails) => void;
	noteId?: NoteId | null;
	onCompleted?: () => void;
	onFailed?: () => void;
	onFinalizeError?: (args: {
		error: unknown;
		terminalization: HostedAssistantRunTerminalization;
	}) => void;
	onWaitingForUser?: () => void;
	onTitleGenerationError?: (args: {
		error: unknown;
		responseMessage: UIMessage;
	}) => void;
	safetyIdentifier: string;
	saveAssistantMessageForRun: (
		args: SaveAssistantMessageForRunArgs<WorkspaceId, NoteId, AssistantRunId>,
	) => Promise<unknown | null>;
	shouldGenerateChatTitle: boolean;
	updateChatTitle: (args: {
		chatId: string;
		onlyIfReplaceable: true;
		title: string;
		workspaceId: WorkspaceId;
	}) => Promise<unknown>;
	waitForUserDecision: (args: {
		pendingDecision: HostedHumanDecisionPendingDecision;
		runId: AssistantRunId;
		assistantMessageId: string;
	}) => Promise<unknown>;
	workspaceId: WorkspaceId;
}) => (terminalization: HostedAssistantRunTerminalization) => Promise<void>;
