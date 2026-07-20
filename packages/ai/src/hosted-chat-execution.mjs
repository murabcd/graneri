import { createAgentUIStream, readUIMessageStream } from "ai";
import { createHostedChatAgent } from "./hosted-chat-agent.mjs";
import { getHostedUserQuestionRequest } from "./hosted-user-question.mjs";
import { getToolApprovalRequest } from "./tool-approval-state.mjs";

export const prepareHostedAssistantExecution = (settings) =>
	createHostedChatAgent(settings);

export const getHostedAssistantExecutionOutcome = ({
	isAborted,
	responseMessage,
}) => {
	if (isAborted) {
		return { responseMessage, status: "aborted" };
	}
	const approvalRequest = getToolApprovalRequest(responseMessage);
	const userQuestion = getHostedUserQuestionRequest(responseMessage);
	if (approvalRequest && userQuestion) {
		throw new Error(
			"Assistant execution requested approval and user input in one step.",
		);
	}
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
	if (userQuestion) {
		return {
			pendingDecision: userQuestion,
			responseMessage,
			status: "waiting_for_user",
		};
	}
	return { responseMessage, status: "completed" };
};

const createHostedAssistantExecutionStream = async ({
	abortSignal,
	agent,
	assistantMessageId,
	createUiStream = createAgentUIStream,
	messages,
	onError,
	onOutcome,
	onStepEnd,
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
		onEnd: (result) => {
			onOutcome(getHostedAssistantExecutionOutcome(result));
		},
		...(onStepEnd ? { onStepEnd } : {}),
		...(onError ? { onError } : {}),
	});

const consumeHostedAssistantExecutionStream = async ({ onMessage, stream }) => {
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

const requireHostedAssistantExecutionOutcome = ({ latestMessage, outcome }) => {
	if (outcome) {
		return outcome;
	}
	if (!latestMessage) {
		throw new Error(
			"Assistant execution completed without a response message.",
		);
	}
	return getHostedAssistantExecutionOutcome({
		isAborted: false,
		responseMessage: latestMessage,
	});
};

export const startHostedAssistantExecution = async ({
	abortSignal,
	agent,
	assistantMessageId,
	createUiStream,
	delivery,
	messages,
	onStepEnd,
	timeout,
}) => {
	let finishedOutcome = null;
	const stream = await createHostedAssistantExecutionStream({
		agent,
		assistantMessageId,
		messages,
		...(abortSignal ? { abortSignal } : {}),
		...(createUiStream ? { createUiStream } : {}),
		...(onStepEnd ? { onStepEnd } : {}),
		...(timeout ? { timeout } : {}),
		onError: () => "Something went wrong.",
		onOutcome: (outcome) => {
			finishedOutcome = outcome;
		},
	});

	if (delivery.mode === "consume") {
		const latestMessage = await consumeHostedAssistantExecutionStream({
			stream,
			onMessage: delivery.onMessage,
		});
		return {
			outcome: requireHostedAssistantExecutionOutcome({
				latestMessage,
				outcome: finishedOutcome,
			}),
		};
	}

	const [observationStream, deliveryStream] = stream.tee();
	const completion = consumeHostedAssistantExecutionStream({
		stream: observationStream,
		onMessage: delivery.onMessage,
	}).then((latestMessage) =>
		requireHostedAssistantExecutionOutcome({
			latestMessage,
			outcome: finishedOutcome,
		}),
	);

	return {
		completion,
		stream: deliveryStream,
	};
};
