import {
	getHostedUserQuestionRequest,
	hostedUserQuestionDecisionsMatch,
} from "./hosted-user-question.mjs";
import { getToolApprovalRequest } from "./tool-approval-state.mjs";

export const getHostedHumanDecisionRequest = (message) => {
	const approval = getToolApprovalRequest(message);
	const question = getHostedUserQuestionRequest(message);
	if (approval && question) {
		throw new Error(
			"Assistant execution requested approval and clarification in one step.",
		);
	}
	if (approval) {
		return { type: "tool_approval", ...approval };
	}
	return question;
};

export const getHostedHumanDecisionPendingDecision = (message) => {
	const request = getHostedHumanDecisionRequest(message);
	if (request?.type !== "tool_approval") {
		return request;
	}
	const { input: _input, ...decision } = request;
	return decision;
};

export const getPendingHostedHumanDecision = (messages) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === "user") {
			return null;
		}
		const decision = getHostedHumanDecisionRequest(message);
		if (decision) {
			return decision;
		}
	}
	return null;
};

const optionalAuthoritiesMatch = (left, right) =>
	left === right ||
	(Boolean(left) &&
		Boolean(right) &&
		left.access === right.access &&
		left.approval === right.approval &&
		left.provider === right.provider);

const humanDecisionMatches = (request, pendingDecision) => {
	if (
		request.type !== pendingDecision.type ||
		request.assistantMessageId !== pendingDecision.assistantMessageId ||
		request.toolCallId !== pendingDecision.toolCallId
	) {
		return false;
	}

	if (request.type === "user_question") {
		return hostedUserQuestionDecisionsMatch(request, pendingDecision);
	}

	return (
		request.approvalId === pendingDecision.approvalId &&
		request.toolName === pendingDecision.toolName &&
		request.consequence === pendingDecision.consequence &&
		optionalAuthoritiesMatch(request.authority, pendingDecision.authority)
	);
};

export const getMatchingPendingHostedHumanDecision = ({
	messages,
	pendingDecision,
}) => {
	if (!pendingDecision) {
		return null;
	}
	const request = getPendingHostedHumanDecision(messages);
	return request && humanDecisionMatches(request, pendingDecision)
		? request
		: null;
};
