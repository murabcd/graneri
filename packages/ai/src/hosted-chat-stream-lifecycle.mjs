import { pipeHostedActiveStreamText } from "./hosted-chat-active-stream.mjs";
import {
	consumeHostedAssistantExecutionStream,
	createHostedAssistantExecutionStream,
} from "./hosted-chat-execution.mjs";
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
	let finalizationQueue = null;
	let pendingTerminalization = null;
	logLatency("ai.agent_created", {
		hasEnabledTools: finalizedToolSet.hasTools,
		systemPromptLength: systemPrompt.length,
	});

	const stream = await (async () => {
		try {
			return await createHostedAssistantExecutionStream({
				agent,
				messages: chatMessages,
				abortSignal: activeStreamSession.abortSignal,
				assistantMessageId,
				createUiStream,
				onOutcome: (terminalization) => {
					logLatency("stream.finish", streamLatencyTracker.getFinishDetails());
					if (terminalization.status === "aborted") {
						return;
					}
					if (finalizationQueue) {
						finalizationQueue.setTerminalization(terminalization);
						return;
					}
					pendingTerminalization = terminalization;
				},
				onError: () => "Something went wrong.",
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
	if (stream?.ok === false) {
		return stream;
	}

	logLatency("ai.stream_created");
	finalizationQueue = createHostedAssistantRunFinalizationQueue({
		finalizeAssistantRun,
		logLatency,
		runId: assistantRunId,
	});
	if (pendingTerminalization) {
		finalizationQueue.setTerminalization(pendingTerminalization);
		pendingTerminalization = null;
	}
	const [snapshotStream, eventStream] = streamLatencyTracker
		.wrapStream(stream)
		.tee();
	const snapshotPersistence = (async () => {
		await consumeHostedAssistantExecutionStream({
			stream: snapshotStream,
			onMessage: (message) => activeStreamSession.replaceParts(message.parts),
		});
	})().then(
		() => ({ ok: true }),
		(error) => ({ error, ok: false }),
	);
	const requireSnapshotPersistence = async () => {
		const result = await snapshotPersistence;
		if (!result.ok) {
			throw result.error;
		}
	};
	const persistedStream = pipeHostedActiveStreamText({
		onError: async (error) => {
			await snapshotPersistence;
			finalizationQueue?.setTerminalization({
				errorText:
					error instanceof Error
						? error.message
						: "Unknown active stream persistence error",
				status: "failed",
			});
			await finalizationQueue?.flushAfterClientStream();
		},
		onFlush: async () => {
			await requireSnapshotPersistence();
			await finalizationQueue?.flushAfterClientStream();
		},
		persister: activeStreamSession,
		stream: eventStream,
	});

	return {
		ok: true,
		responseStream: activeStreamSession.startBroadcast(persistedStream),
	};
};
