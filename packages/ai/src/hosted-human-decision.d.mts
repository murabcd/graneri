import type { UIMessage } from "ai";
import type { HostedUserQuestionPendingDecision } from "./hosted-user-question.mjs";
import type { ToolApprovalRequest } from "./tool-approval-state.mjs";

export type HostedToolApprovalRequest = ToolApprovalRequest & {
	type: "tool_approval";
};

export type HostedHumanDecisionRequest =
	| HostedUserQuestionPendingDecision
	| HostedToolApprovalRequest;

export type HostedToolApprovalPendingDecision = Omit<
	HostedToolApprovalRequest,
	"input"
>;

export type HostedHumanDecisionPendingDecision =
	| HostedUserQuestionPendingDecision
	| HostedToolApprovalPendingDecision;

export declare const getHostedHumanDecisionRequest: (
	message: UIMessage,
) => HostedHumanDecisionRequest | null;

export declare const getHostedHumanDecisionPendingDecision: (
	message: UIMessage,
) => HostedHumanDecisionPendingDecision | null;

export declare const getPendingHostedHumanDecision: (
	messages: UIMessage[],
) => HostedHumanDecisionRequest | null;
