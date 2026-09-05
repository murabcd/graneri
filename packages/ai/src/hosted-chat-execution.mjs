import { createAgentUIStream, readUIMessageStream } from "ai";
import { createHostedChatAgent } from "./hosted-chat-agent.mjs";
import { getHostedHumanDecisionPendingDecision } from "./hosted-human-decision.mjs";

export const prepareHostedAssistantExecution = (settings) =>
	createHostedChatAgent(settings);

export const getHostedAssistantExecutionOutcome = ({
	isAborted,
	responseMessage,
}) => {
	if (isAborted) {
		return { responseMessage, status: "aborted" };
	}
	const pendingDecision =
		getHostedHumanDecisionPendingDecision(responseMessage);
	if (pendingDecision) {
		return {
			pendingDecision,
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
		...(abortSignal && { abortSignal }),
		originalMessages: messages,
		generateMessageId: () => assistantMessageId,
		sendReasoning: true,
		sendSources: true,
		...(timeout && { timeout }),
		onEnd: (result) => {
			onOutcome(getHostedAssistantExecutionOutcome(result));
		},
		...(onStepEnd && { onStepEnd }),
		...(onError && { onError }),
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
		...(abortSignal && { abortSignal }),
		...(createUiStream && { createUiStream }),
		...(onStepEnd && { onStepEnd }),
		...(timeout && { timeout }),
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

	const observation = new TransformStream();
	const writer = observation.writable.getWriter();
	const reader = stream.getReader();
	const completion = consumeHostedAssistantExecutionStream({
		stream: observation.readable,
		onMessage: delivery.onMessage,
	}).then((latestMessage) =>
		requireHostedAssistantExecutionOutcome({
			latestMessage,
			outcome: finishedOutcome,
		}),
	);
	let observationError = null;
	void completion.catch(async (error) => {
		observationError = error;
		await Promise.allSettled([reader.cancel(error), writer.abort(error)]);
	});
	return {
		completion,
		stream: new ReadableStream({
			async pull(controller) {
				try {
					const result = await reader.read();
					if (result.done) {
						await writer.close();
						await completion;
						controller.close();
						return;
					}
					await writer.write(result.value);
					controller.enqueue(result.value);
				} catch (error) {
					controller.error(observationError ?? error);
					await Promise.allSettled([reader.cancel(error), writer.abort(error)]);
				}
			},
			async cancel(reason) {
				await Promise.allSettled([reader.cancel(reason), writer.abort(reason)]);
			},
		}),
	};
};
