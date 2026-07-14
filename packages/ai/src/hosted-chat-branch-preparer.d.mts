import type { UIMessage } from "ai";

type LogLatencyDetails = Record<
	string,
	boolean | null | number | string | undefined
>;

type StoredHostedChatMessage = {
	id: string;
	role: UIMessage["role"];
	partsJson: string;
	metadataJson?: string;
};

type AssistantRunEvent = {
	event: {
		assistantMessageId?: string;
		type: string;
	};
};

type PreparedHostedChatTurnBranch = {
	branchMessageId?: string;
	editedMessageIndex: number;
	incomingMessages: UIMessage[];
	shouldCreateChatBranch: boolean;
};

export declare const getHostedInterruptedAssistantMessageIds: (
	runEvents: AssistantRunEvent[],
) => string[];

export declare const prepareHostedChatTurnBranch: <
	WorkspaceId extends string,
	ChatId extends string,
	RunId extends string,
>(args: {
	attachableRunId?: RunId | null;
	chatId: ChatId;
	continueRunId?: RunId | null;
	getMessagesSnapshot: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
	}) => Promise<StoredHostedChatMessage[]>;
	listRunEventsAfter: (args: {
		runId: RunId;
		limit: 500;
	}) => Promise<AssistantRunEvent[]>;
	logLatency?: (stage: string, details?: LogLatencyDetails) => void;
	message?: UIMessage | null;
	messageId?: string | null;
	messages?: UIMessage[];
	onBranchError?: (args: {
		error: unknown;
		messageId: string;
	}) => Promise<boolean> | boolean;
	pendingMessages?: UIMessage[];
	prepareMessage?: (args: {
		message?: UIMessage | null;
		storedMessages: StoredHostedChatMessage[];
	}) => Promise<UIMessage | null | undefined> | UIMessage | null | undefined;
	shouldLoadStoredMessages?: boolean;
	storedMessagesForStatelessBranch?: StoredHostedChatMessage[];
	trigger?: "submit-message" | "regenerate-message";
	branchFromMessage: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		messageId: string;
	}) => Promise<unknown>;
	workspaceId: WorkspaceId;
}) => Promise<
	| {
			ok: true;
			preparedBranch: PreparedHostedChatTurnBranch;
			shouldCreateChatBranch: boolean;
			storedMessages: StoredHostedChatMessage[];
	  }
	| {
			ok: false;
			reason: "branch_error_handled";
	  }
>;
