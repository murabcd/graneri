import type { Tool, UIMessage } from "ai";

export declare const HOSTED_REQUEST_USER_INPUT_TOOL_NAME: "request_user_input";

export type HostedUserQuestionPendingDecision = {
	type: "user_question";
	assistantMessageId: string;
	toolCallId: string;
	question: string;
};

export declare const createHostedRequestUserInputTool: () => Tool;

export declare const getHostedUserQuestionRequest: (
	message: UIMessage,
) => HostedUserQuestionPendingDecision | null;

export declare const resolveHostedUserQuestionMessage: (args: {
	message: UIMessage;
	decision: HostedUserQuestionPendingDecision;
}) => UIMessage | null;
