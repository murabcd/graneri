import { projectUiMessagesForAssistantGeneration } from "./assistant-generation-context.mjs";
import { pipeHostedActiveStreamText } from "./hosted-chat-active-stream.mjs";
import { startHostedAssistantExecution } from "./hosted-chat-execution.mjs";
import { createHostedAssistantRunFinalizationQueue } from "./hosted-chat-run-finalization-queue.mjs";

const groupResponsePartsByStep = (parts) => {
	const steps = [];
	for (const part of parts) {
		if (part.type === "step-start" || steps.length === 0) {
			steps.push([]);
		}
		steps.at(-1).push(part);
	}
	return steps;
};

export const buildHostedSteeredGenerationTranscript = ({
	consumed,
	pending,
	responseMessage,
}) => {
	const consumedByStep = new Map();
	for (const batch of consumed) {
		const inputs = consumedByStep.get(batch.stepNumber) ?? [];
		inputs.push(...batch.input);
		consumedByStep.set(batch.stepNumber, inputs);
	}

	const transcript = [];
	let assistantParts = [];
	let assistantSegmentIndex = 0;
	const flushAssistant = () => {
		if (assistantParts.length === 0) {
			return;
		}
		transcript.push({
			...responseMessage,
			id:
				assistantSegmentIndex === 0 && transcript.length === 0
					? responseMessage.id
					: `stream-${responseMessage.id}-${assistantSegmentIndex}`,
			parts: assistantParts,
		});
		assistantParts = [];
		assistantSegmentIndex += 1;
	};

	const responseSteps = groupResponsePartsByStep(responseMessage.parts);
	const lastStepNumber = Math.max(
		responseSteps.length - 1,
		...consumed.map((batch) => batch.stepNumber),
	);
	for (let stepNumber = 0; stepNumber <= lastStepNumber; stepNumber += 1) {
		const stepInput = consumedByStep.get(stepNumber) ?? [];
		if (stepInput.length > 0) {
			flushAssistant();
			transcript.push(...stepInput);
		}
		assistantParts.push(...(responseSteps[stepNumber] ?? []));
	}
	flushAssistant();
	transcript.push(...pending);

	return transcript;
};

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
	instructions,
	logLatency,
	onStreamCreateError,
	streamLatencyTracker,
}) => {
	logLatency("ai.agent_created", {
		hasEnabledTools: finalizedToolSet.hasTools,
		instructionsLength: instructions.length,
	});

	let currentAssistantMessageId = assistantMessageId;
	const startExecution = async (messages) => {
		try {
			return await startHostedAssistantExecution({
				agent,
				messages,
				abortSignal: activeStreamSession.abortSignal,
				assistantMessageId: currentAssistantMessageId,
				createUiStream,
				delivery: {
					mode: "stream",
					onMessage: (message) =>
						activeStreamSession.replaceParts(message.parts),
				},
			});
		} catch (error) {
			await onStreamCreateError?.(error);
			let terminalizationError = null;
			try {
				await failAssistantRun({
					runId: assistantRunId,
					assistantMessageId: currentAssistantMessageId,
					errorText: error instanceof Error ? error.message : "Unknown error",
				});
			} catch (failError) {
				terminalizationError = failError;
			} finally {
				activeStreamSession.cleanup();
			}
			return {
				error,
				terminalizationError,
				ok: false,
			};
		}
	};
	const firstExecution = await startExecution(chatMessages);
	if (firstExecution.ok === false) {
		return firstExecution;
	}

	logLatency("ai.stream_created");
	const finalizationQueue = createHostedAssistantRunFinalizationQueue({
		finalizeAssistantRun,
		logLatency,
		runId: assistantRunId,
	});
	let resolveObservedExecution;
	let rejectObservedExecution;
	const observedExecution = new Promise((resolve, reject) => {
		resolveObservedExecution = resolve;
		rejectObservedExecution = reject;
	});
	void observedExecution.catch(() => undefined);
	const responseStream = new TransformStream();
	const responseWriter = responseStream.writable.getWriter();
	void (async () => {
		let execution = firstExecution;
		let messages = chatMessages;
		try {
			for (;;) {
				for await (const chunk of execution.stream) {
					await responseWriter.write(chunk);
				}
				const terminalization = await execution.completion;
				const generationResponseMessage =
					"responseMessage" in terminalization
						? terminalization.responseMessage
						: null;
				let responseMessage = generationResponseMessage;
				const canContinueFromSteer =
					terminalization.status === "completed" ||
					terminalization.status === "waiting_for_user";
				if (canContinueFromSteer) {
					activeStreamSession.closeSteeredUserMessageAcceptance();
					await activeStreamSession.waitForSteeredUserMessageReservations();
				}
				const steerBoundary = canContinueFromSteer
					? activeStreamSession.takeSteeredUserMessageGenerationBoundary()
					: { consumed: [], pending: [], steerAcceptances: [] };
				const steeredGenerationTranscript = generationResponseMessage
					? buildHostedSteeredGenerationTranscript({
							consumed: steerBoundary.consumed,
							pending: steerBoundary.pending,
							responseMessage: generationResponseMessage,
						})
					: [];
				const consumedSteerCount = steerBoundary.consumed.reduce(
					(count, batch) => count + batch.input.length,
					0,
				);
				const shouldCommitSteeredGeneration =
					generationResponseMessage &&
					(consumedSteerCount > 0 || steerBoundary.pending.length > 0) &&
					(terminalization.status === "completed" ||
						steerBoundary.pending.length === 0);
				if (shouldCommitSteeredGeneration) {
					const assistantMessages = steeredGenerationTranscript.filter(
						(message) => message.role === "assistant",
					);
					const activeAssistantMessage =
						steerBoundary.pending.length === 0
							? (assistantMessages.at(-1) ?? null)
							: null;
					const completedAssistantMessages = activeAssistantMessage
						? assistantMessages.slice(0, -1)
						: assistantMessages;
					const nextAssistantMessageId =
						activeAssistantMessage?.id ?? `stream-${crypto.randomUUID()}`;
					await activeStreamSession.transitionGeneration({
						activeAssistantMessage,
						completedAssistantMessages,
						nextAssistantMessageId,
						orderedMessageIds: steeredGenerationTranscript.map(
							(message) => message.id,
						),
						steerAcceptances: steerBoundary.steerAcceptances,
					});
					currentAssistantMessageId = nextAssistantMessageId;
					if (activeAssistantMessage) {
						responseMessage = activeAssistantMessage;
					}
				}
				if (
					terminalization.status === "completed" &&
					generationResponseMessage &&
					steerBoundary.pending.length > 0
				) {
					messages = projectUiMessagesForAssistantGeneration([
						...messages,
						...steeredGenerationTranscript,
					]);
					execution = await startExecution(messages);
					if (execution.ok === false) {
						throw execution.error;
					}
					activeStreamSession.openSteeredUserMessageAcceptance();
					continue;
				}
				const finalTerminalization = responseMessage
					? { ...terminalization, responseMessage }
					: terminalization;
				activeStreamSession.closeSteeredUserMessageAcceptance();
				logLatency("stream.finish", streamLatencyTracker.getFinishDetails());
				if (finalTerminalization.status !== "aborted") {
					finalizationQueue.setTerminalization(finalTerminalization);
				}
				resolveObservedExecution({ ok: true });
				await responseWriter.close();
				return;
			}
		} catch (error) {
			rejectObservedExecution(error);
			finalizationQueue.setTerminalization({
				errorText:
					error instanceof Error
						? error.message
						: "Unknown active stream persistence error",
				status: "failed",
			});
			try {
				await finalizationQueue.flushAfterClientStream();
			} catch {
				// The client stream still receives the original execution failure.
			}
			await responseWriter.abort(error);
		}
	})();
	const requireObservedExecution = async () => {
		const result = await observedExecution;
		if (!result.ok) {
			throw result.error;
		}
	};
	const persistedStream = pipeHostedActiveStreamText({
		onError: async (error) => {
			try {
				await observedExecution;
			} catch {
				// The persistence error below is the terminal failure for this stream.
			}
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
		stream: streamLatencyTracker.wrapStream(responseStream.readable),
	});

	return {
		ok: true,
		responseStream: activeStreamSession.startBroadcast(persistedStream),
	};
};
