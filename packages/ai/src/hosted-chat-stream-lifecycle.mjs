import { pipeHostedActiveStreamText } from "./hosted-chat-active-stream.mjs";
import { startHostedAssistantExecution } from "./hosted-chat-execution.mjs";
import { createHostedAssistantRunFinalizationQueue } from "./hosted-chat-run-finalization-queue.mjs";

export const createHostedChatRunResponseStream = async ({
	activeStreamSession,
	agent,
	assistantMessageId,
	assistantRunId,
	chatMessages,
	createUiStream,
	failAssistantRun,
	finalizeAssistantRun,
	finalizedToolSet,
	logLatency,
	onStreamCreateError,
	streamLatencyTracker,
	systemPrompt,
}) => {
	logLatency("ai.agent_created", {
		hasEnabledTools: finalizedToolSet.hasTools,
		systemPromptLength: systemPrompt.length,
	});

	const execution = await (async () => {
		try {
			return await startHostedAssistantExecution({
				agent,
				messages: chatMessages,
				abortSignal: activeStreamSession.abortSignal,
				assistantMessageId,
				createUiStream,
				delivery: {
					mode: "stream",
					onMessage: (message) =>
						activeStreamSession.replaceParts(message.parts),
				},
			});
		} catch (error) {
			await onStreamCreateError?.(error);
			await failAssistantRun({
				runId: assistantRunId,
				errorText: error instanceof Error ? error.message : "Unknown error",
			});
			activeStreamSession.cleanup();
			return {
				error,
				ok: false,
			};
		}
	})();
	if (execution?.ok === false) {
		return execution;
	}

	logLatency("ai.stream_created");
	const finalizationQueue = createHostedAssistantRunFinalizationQueue({
		finalizeAssistantRun,
		logLatency,
		runId: assistantRunId,
	});
	const observedExecution = execution.completion.then(
		(terminalization) => {
			logLatency("stream.finish", streamLatencyTracker.getFinishDetails());
			if (terminalization.status !== "aborted") {
				finalizationQueue.setTerminalization(terminalization);
			}
			return { ok: true };
		},
		(error) => ({ error, ok: false }),
	);
	const requireObservedExecution = async () => {
		const result = await observedExecution;
		if (!result.ok) {
			throw result.error;
		}
	};
	const persistedStream = pipeHostedActiveStreamText({
		onError: async (error) => {
			await observedExecution;
			finalizationQueue.setTerminalization({
				errorText:
					error instanceof Error
						? error.message
						: "Unknown active stream persistence error",
				status: "failed",
			});
			await finalizationQueue.flushAfterClientStream();
		},
		onFlush: async () => {
			await requireObservedExecution();
			await finalizationQueue.flushAfterClientStream();
		},
		persister: activeStreamSession,
		stream: streamLatencyTracker.wrapStream(execution.stream),
	});

	return {
		ok: true,
		responseStream: activeStreamSession.startBroadcast(persistedStream),
	};
};
