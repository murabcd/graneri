import type { UIMessage } from "ai";
import type { ChatMode } from "./chat-mode.mjs";
import type { StoredUiMessageRole } from "./ui-message-codec.mjs";

export declare const hostedChatSteerAcceptedHeader: "X-Graneri-Steer-Accepted";
export declare const hostedChatReplayAcceptedHeader: "X-Graneri-Replay-Accepted";
export declare const hostedChatSteerTurnIdHeader: "X-Graneri-Turn-Id";
export declare const hostedChatSteerQueuedMessageIdHeader: "X-Graneri-Queued-Message-Id";
export declare const hostedChatReplayQueuedMessageIdHeader: "X-Graneri-Replay-Queued-Message-Id";
export declare const HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE: "input_empty";
export declare const HOSTED_CHAT_CONVEX_DEPLOYMENT_OUT_OF_SYNC_ERROR_CODE: "convex_deployment_out_of_sync";
export declare const getHostedChatSteerAcceptanceHeaders: (args: {
	queuedMessageId: string;
	turnId: string;
}) => Record<string, string>;
export declare const getHostedChatReplayAcceptanceHeaders: (args: {
	queuedMessageId: string;
}) => Record<string, string>;
export declare const getHostedChatConvexRouteError: (error: unknown) => null | {
	error: string;
	errorCode: string;
	statusCode: 400 | 409 | 500;
};
export declare const getHostedChatSteerTelemetry: (args: {
	acceptedTurnId?: string | null;
	errorCode?: string | null;
	expectedTurnId?: string | null;
	isSteerRoute: boolean;
	outcome?: "error" | "success" | null;
	queuedMessageId?: string | null;
}) => null | {
	turn_steer_accepted_turn_id: string | null;
	turn_steer_expected_turn_id: string | null;
	turn_steer_num_input_images: 0;
	turn_steer_queued_message_id: string | null;
	turn_steer_rejection_reason: string | null;
	turn_steer_result: "accepted" | "rejected";
};
export type HostedChatTurnIntent<
	RunId extends string = string,
	QueuedMessageId extends string = string,
> =
	| { type: "direct"; continueRunId: RunId | null }
	| {
			type: "replay";
			expectedStatus: "paused" | "queued";
			queuedMessageId: QueuedMessageId;
	  }
	| { type: "steer"; queuedMessageId: QueuedMessageId; runId: RunId };
export declare const parseHostedChatTurnIntent: (args: {
	continueRunId?: unknown;
	hasMessage?: boolean;
	isSteerRoute: boolean;
	replayQueuedMessageId?: unknown;
	replayQueuedMessageStatus?: unknown;
	steerQueuedMessageId?: unknown;
}) =>
	| { ok: true; intent: HostedChatTurnIntent }
	| {
			ok: false;
			error: string;
			errorCode:
				| "continue_run_id_invalid"
				| "queued_message_body_conflict"
				| "queued_message_mode_conflict"
				| "queued_replay_active_run_conflict"
				| "replay_queued_message_id_invalid"
				| "replay_queued_message_status_invalid"
				| "steer_context_missing"
				| "steer_queued_message_id_invalid"
				| "steer_route_required";
			statusCode: 400;
	  };
export declare const getHostedChatInputValidationErrorResponse: (
	error: unknown,
) => {
	errorCode: typeof HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE;
	payload: {
		error: string;
	};
};
export declare const validateHostedChatRequestInput: (args: {
	allowLocalFolderToolContinuation?: boolean;
	message?: UIMessage | null;
	turnIntent: HostedChatTurnIntent;
}) => null | {
	errorCode: "message_missing" | typeof HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE;
	payload: {
		error: string;
	};
	statusCode: 400;
};
export declare const validateHostedChatActiveRunPolicy: (args: {
	attachableRun?: { _id: string } | null;
	continueRunId?: string | null;
	supersedeActiveRun?: boolean;
	trigger?: "submit-message" | "regenerate-message" | string | null;
}) => null | {
	activeRunId: string;
	error: "Chat already has an active assistant run.";
	errorCode: "active_run_exists";
	statusCode: 409;
};
export declare const createHostedChatInputEmptyError: () => Error & {
	code: typeof HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE;
};
export declare const validateHostedChatInput: (message: UIMessage) => void;
export declare const clampHostedChatWhitespace: (value: string) => string;
export declare const clampHostedNoteContext: (value: string) => string;
export declare const generateHostedChatMessageId: () => string;
export declare const getHostedChatMessageText: (message: UIMessage) => string;
export declare const getHostedChatPreviewFromMessage: (
	message: UIMessage,
) => string;
export declare const toHostedStoredMessage: (message: UIMessage) => {
	id: string;
	role: StoredUiMessageRole;
	partsJson: string;
	metadataJson: string | undefined;
	text: string;
	createdAt: number;
};
export declare const toHostedQueuedUserMessage: (queuedMessage: {
	messageId: string;
	metadataJson?: string;
	filesJson: string;
	text: string;
}) => UIMessage;
export declare const buildHostedChatSaveMessageArgs: <
	WorkspaceId extends string,
	NoteId extends string,
>(args: {
	chatId: string;
	message: UIMessage;
	noteId?: NoteId | null;
	title?: string;
	workspaceId: WorkspaceId;
}) => {
	workspaceId: WorkspaceId;
	chatId: string;
	noteId: NoteId | undefined;
	title: string | undefined;
	preview: string;
	message: ReturnType<typeof toHostedStoredMessage>;
};
export declare const prepareHostedChatBranch: (args: {
	interruptedAssistantMessageIds?: string[];
	message?: UIMessage;
	messageId?: string;
	messages?: UIMessage[];
	storedMessages?: Array<{
		id: string;
		role: StoredUiMessageRole;
		partsJson: string;
		metadataJson?: string;
	}>;
	trigger?: "submit-message" | "regenerate-message";
}) => {
	editedMessageIndex: number;
	incomingMessages: UIMessage[];
	branchMessageId: string | undefined;
	shouldCreateChatBranch: boolean;
};
export declare const getInlineHostedNoteContext: (args: {
	title?: string;
	text?: string;
}) => string;
export declare const getStoredHostedNoteContext: (
	note:
		| {
				title: string;
				searchableText?: string | null;
		  }
		| null
		| undefined,
) => string;
export declare const buildHostedNotesContext: (
	notes: Array<{
		title: string;
		searchableText?: string | null;
	}>,
) => string;
export declare const getHostedChatRecipeContext: (
	selectedRecipe:
		| {
				name: string;
				prompt: string;
		  }
		| null
		| undefined,
) => string;
export declare const buildHostedChatRuntimeInstructions: (args: {
	attachedNoteContext?: string;
	chatMode?: ChatMode;
	compactionSummary?: string | null;
	localFolderContext?: string;
	notesContext?: string;
	recipeContext?: string;
	selectedAppSourceInstructions?: string;
	userProfileContext?: unknown;
	webSearchEnabled?: boolean;
}) => string;
export declare const generateHostedChatTitle: (args: {
	assistantMessage?: UIMessage;
	safetyIdentifier: string;
	userMessage: UIMessage;
}) => Promise<string>;
export { createHostedActiveChatStreamSession } from "./hosted-chat-active-stream.mjs";
export { buildHostedSteeredGenerationTranscript } from "./hosted-chat-stream-lifecycle.mjs";
