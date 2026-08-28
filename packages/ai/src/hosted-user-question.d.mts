import type { Tool, UIMessage } from "ai";
import type { ChatMode } from "./chat-mode.mjs";
import type { TrustedStoredUiMessageInput } from "./ui-message-codec.mjs";

export declare const HOSTED_REQUEST_USER_INPUT_TOOL_NAME: "request_user_input";

export type HostedUserQuestionOption = {
	label: string;
	description: string;
};

export type HostedUserQuestion = {
	id: string;
	question: string;
	options: HostedUserQuestionOption[];
};

export type HostedUserQuestionPendingDecision = {
	type: "user_question";
	assistantMessageId: string;
	toolCallId: string;
	questions: HostedUserQuestion[];
};

export declare const createHostedUserQuestionTools: (
	chatMode: ChatMode,
) => Partial<Record<typeof HOSTED_REQUEST_USER_INPUT_TOOL_NAME, Tool>>;

export declare const getHostedUserQuestionRequest: (
	message: UIMessage,
) => HostedUserQuestionPendingDecision | null;

export declare const hostedUserQuestionDecisionsMatch: (
	left: HostedUserQuestionPendingDecision,
	right: HostedUserQuestionPendingDecision,
) => boolean;

export declare const getHostedUserQuestionAnswer: (args: {
	message: UIMessage;
	decision: HostedUserQuestionPendingDecision;
}) => string | null;

export declare const isHostedUserQuestionAnswerMessage: (
	message: UIMessage,
) => boolean;

export declare const createCanonicalHostedUserQuestionAnswer: (args: {
	answer: string;
	decision: HostedUserQuestionPendingDecision;
	storedMessage: TrustedStoredUiMessageInput | null | undefined;
}) => UIMessage;

export declare const resolveHostedUserQuestionMessage: (args: {
	message: UIMessage;
	decision: HostedUserQuestionPendingDecision;
	answer: string;
}) => UIMessage | null;
