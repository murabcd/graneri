import type { UIMessage } from "ai";
import type {
	HostedChatStoredContextMessage,
	prepareHostedChatContextWindow,
} from "./hosted-chat-context-window.mjs";
import type { buildHostedChatRunContext } from "./hosted-chat-run-context.mjs";

type LogLatencyDetails = Record<
	string,
	boolean | null | number | string | undefined
>;

type AssistantRunEvent = {
	event: {
		assistantMessageId?: string;
		type: string;
	};
};

type RunContext = Awaited<ReturnType<typeof buildHostedChatRunContext>>;
type RunContextInput = Omit<
	Parameters<typeof buildHostedChatRunContext>[0],
	"compactionSummary"
>;

export declare const prepareHostedAssistantRunInput: <
	WorkspaceId extends string,
	ChatId extends string,
	RunId extends string,
>(args: {
	attachableRunId?: RunId | null;
	branchFromMessage: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		messageId: string;
	}) => Promise<unknown>;
	chatId: ChatId;
	contextWindow: Parameters<typeof prepareHostedChatContextWindow>[0];
	continueRunId?: RunId | null;
	getMessagesSnapshot: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
	}) => Promise<HostedChatStoredContextMessage[]>;
	listRunEventsAfter: (args: {
		runId: RunId;
		limit: 500;
	}) => Promise<AssistantRunEvent[]>;
	logLatency?: (stage: string, details?: LogLatencyDetails) => void;
	message?: UIMessage | null;
	messageId?: string | null;
	onBranchError?: (args: {
		error: unknown;
		messageId: string;
	}) => Promise<boolean> | boolean;
	pendingMessages?: UIMessage[];
	prepareMessage?: (args: {
		message?: UIMessage | null;
		storedMessages: HostedChatStoredContextMessage[];
	}) => Promise<UIMessage | null | undefined> | UIMessage | null | undefined;
	trigger?: "submit-message" | "regenerate-message";
	workspaceId: WorkspaceId;
}) => Promise<
	| {
			ok: false;
			reason: "branch_error_handled";
	  }
	| {
			ok: true;
			complete: (context: RunContextInput) => Promise<
				RunContext & {
					chatMessages: UIMessage[];
					inputMessage: UIMessage | null | undefined;
				}
			>;
	  }
>;
