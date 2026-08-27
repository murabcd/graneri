import type { Tool, UIMessage } from "ai";

export declare const HOSTED_REQUEST_USER_INPUT_TOOL_NAME: "request_user_input";

export type HostedUserQuestionOption = {
	label: string;
	description?: string;
};

export type HostedUserQuestionPendingDecision = {
	type: "user_question";
	assistantMessageId: string;
	toolCallId: string;
	question: string;
	responseType: "text" | "choice";
	options?: HostedUserQuestionOption[];
	consequence?: string;
};

export declare const createHostedRequestUserInputTool: () => Tool;

export declare const getHostedUserQuestionRequest: (
	message: UIMessage,
) => HostedUserQuestionPendingDecision | null;

export declare const resolveHostedUserQuestionMessage: (args: {
	message: UIMessage;
	decision: HostedUserQuestionPendingDecision;
}) => UIMessage | null;
