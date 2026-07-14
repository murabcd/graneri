import {
	createAgentUIStream,
	readUIMessageStream,
	validateUIMessages,
} from "ai";
import { createHostedChatAgent } from "./hosted-chat-agent.mjs";
import { getToolApprovalRequest } from "./tool-approval-state.mjs";

export const createHostedAssistantAgent = (settings) =>
	createHostedChatAgent(settings);

export const validateHostedAssistantMessages = ({ messages, tools }) =>
	validateUIMessages({ messages, tools });

export const getHostedAssistantExecutionOutcome = ({
	isAborted,
	responseMessage,
}) => {
	if (isAborted) {
		return { responseMessage, status: "aborted" };
	}
	const approvalRequest = getToolApprovalRequest(responseMessage);
	if (approvalRequest) {
		return {
			pendingDecision: {
				type: "tool_approval",
				approvalId: approvalRequest.approvalId,
				assistantMessageId: approvalRequest.assistantMessageId,
				toolCallId: approvalRequest.toolCallId,
				toolName: approvalRequest.toolName,
			},
			responseMessage,
			status: "waiting_for_user",
		};
	}
	return { responseMessage, status: "completed" };
};

export const createHostedAssistantExecutionStream = async ({
	abortSignal,
	agent,
	assistantMessageId,
	createUiStream = createAgentUIStream,
	messages,
	onError,
	onOutcome,
	timeout,
}) =>
	await createUiStream({
		agent,
		uiMessages: messages,
		...(abortSignal ? { abortSignal } : {}),
		originalMessages: messages,
		generateMessageId: () => assistantMessageId,
		sendReasoning: true,
		sendSources: true,
		...(timeout ? { timeout } : {}),
		onFinish: (result) => {
			onOutcome(getHostedAssistantExecutionOutcome(result));
		},
		...(onError ? { onError } : {}),
	});

export const consumeHostedAssistantExecutionStream = async ({
	onMessage,
	stream,
}) => {
	let latestMessage = null;
	for await (const message of readUIMessageStream({
		stream,
		terminateOnError: true,
	})) {
		latestMessage = message;
		await onMessage?.(message);
	}
	return latestMessage;
};
