import { createHostedChatStreamBroadcast } from "./hosted-chat-stream-broadcast.mjs";
import { createHostedTurnInputBuffer } from "./hosted-chat-turn-input-buffer.mjs";

export const HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS = 250;

export const createHostedActiveStreamKey = ({ workspaceId, chatId }) =>
	`${workspaceId}:${chatId}`;

export class HostedActiveChatStreamPersister {
	#acceptingAppends = true;
	#buffer = "";
	#chatId;
	#discarded = false;
	#finishActiveStream;
	#finishActiveStreamToolCall;
	#flushError = null;
	#flushPromise = null;
	#flushTimer = null;
	#messageId;
	#latestParts = [];
	#parts = null;
	#runId;
	#startActiveStream;
	#startActiveStreamToolCall;
	#transitionActiveStreamGeneration;
	#updateActiveStream;
	#workspaceId;

	constructor({
		chatId,
		finishActiveStream,
		finishActiveStreamToolCall,
		messageId,
		runId,
		startActiveStream,
		startActiveStreamToolCall,
		transitionActiveStreamGeneration,
		updateActiveStream,
		workspaceId,
	}) {
		this.#chatId = chatId;
		this.#finishActiveStream = finishActiveStream;
		this.#finishActiveStreamToolCall = finishActiveStreamToolCall;
		this.#messageId = messageId;
		this.#runId = runId;
		this.#startActiveStream = startActiveStream;
		this.#startActiveStreamToolCall = startActiveStreamToolCall;
		this.#transitionActiveStreamGeneration = transitionActiveStreamGeneration;
		this.#updateActiveStream = updateActiveStream;
		this.#workspaceId = workspaceId;
	}

	get messageId() {
		return this.#messageId;
	}

	get runId() {
		return this.#runId;
	}

	get responseMessage() {
		return {
			id: this.#messageId,
			role: "assistant",
			parts: this.#latestParts,
		};
	}

	async start() {
		await this.#startActiveStream({
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			runId: this.#runId,
		});
	}

	append(delta) {
		if (!this.#acceptingAppends || this.#discarded) {
			return;
		}

		if (!delta) {
			return;
		}

		this.#buffer += delta;
		this.#scheduleFlush();
	}

	replaceParts(parts) {
		if (!this.#acceptingAppends || this.#discarded) {
			return;
		}

		this.#latestParts = parts;
		this.#parts = parts;
		this.#scheduleFlush();
	}

	#scheduleFlush() {
		if (this.#flushTimer || this.#flushPromise || this.#flushError) {
			return;
		}

		this.#flushTimer = setTimeout(() => {
			this.#flushTimer = null;
			// flush retains failures for the terminal caller; scheduled work is observed.
			void this.flush().catch(() => undefined);
		}, HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS);
	}

	async startToolCall({ input, toolCallId, toolName }) {
		await this.#startActiveStreamToolCall({
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			runId: this.#runId,
			assistantMessageId: this.#messageId,
			toolCallId,
			toolName,
			inputJson: stringifyToolPayload(input),
		});
	}

	async finishToolCall({ errorText, output, status, toolCallId }) {
		await this.#finishActiveStreamToolCall({
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			runId: this.#runId,
			assistantMessageId: this.#messageId,
			toolCallId,
			status,
			outputJson: stringifyToolPayload(output),
			errorText,
		});
	}

	async transitionGeneration(args) {
		if (!this.#transitionActiveStreamGeneration) {
			throw new Error("Active stream generation transition is unavailable.");
		}
		await this.flush();
		await this.#transitionActiveStreamGeneration({
			...args,
			assistantMessageId: this.#messageId,
			runId: this.#runId,
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
		});
		this.#messageId = args.nextAssistantMessageId;
		this.#latestParts = args.activeAssistantMessage?.parts ?? [];
		this.#buffer = "";
		this.#parts = null;
	}

	async flush() {
		if (this.#discarded) return;
		if (this.#flushError) throw this.#flushError;
		if (this.#flushTimer) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = null;
		}
		do {
			if (!this.#flushPromise) {
				this.#flushPromise = this.#drain()
					.catch((error) => {
						this.#flushError =
							error instanceof Error
								? error
								: new Error("Active stream persistence failed.", {
										cause: error,
									});
						throw this.#flushError;
					})
					.finally(() => {
						this.#flushPromise = null;
						if (!this.#discarded && (this.#buffer || this.#parts !== null))
							this.#scheduleFlush();
					});
			}
			await this.#flushPromise;
		} while (
			!this.#discarded &&
			(this.#flushPromise || this.#buffer || this.#parts !== null)
		);
	}

	async #drain() {
		while (!this.#discarded && (this.#buffer || this.#parts !== null)) {
			const delta = this.#buffer;
			const parts = this.#parts;
			this.#buffer = "";
			this.#parts = null;
			await this.#updateActiveStream({
				workspaceId: this.#workspaceId,
				chatId: this.#chatId,
				runId: this.#runId,
				assistantMessageId: this.#messageId,
				...(delta && { delta }),
				...(parts !== null && { partsJson: stringifyToolPayload(parts) }),
			});
		}
	}

	async finish() {
		this.#acceptingAppends = false;
		await this.flush();
		if (this.#discarded) {
			return;
		}

		await this.#finishActiveStream({
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			runId: this.#runId,
			assistantMessageId: this.#messageId,
		});
		this.#discardPending();
	}

	async closePersistence() {
		this.#acceptingAppends = false;
		await this.flush();
		this.#discardPending();
	}

	discardPending() {
		this.#acceptingAppends = false;
		this.#discardPending();
	}

	#discardPending() {
		this.#discarded = true;
		this.#buffer = "";
		this.#parts = null;
		if (this.#flushTimer) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = null;
		}
	}
}

export const createHostedActiveStreamSession = ({
	controllers,
	persister,
	streamKey,
	turnInput,
}) => {
	const abortController = new AbortController();
	const broadcast = createHostedChatStreamBroadcast();
	const steerAcceptancesByMessageId = new Map();
	const steerReservationWaiters = new Set();
	let acceptsSteeredUserMessages = true;
	let isDisposed = false;
	let outstandingSteerReservations = 0;
	let preparedDurableStopBoundary = null;
	let retainsSessionForDurableStop = false;
	const attachSteeredUserMessage = (message, acceptance) => {
		turnInput.extendSteerInput(message);
		if (acceptance) {
			steerAcceptancesByMessageId.set(message.id, acceptance);
		}
		return true;
	};

	const releaseSteerReservation = () => {
		outstandingSteerReservations -= 1;
		if (outstandingSteerReservations === 0) {
			for (const resolve of steerReservationWaiters) {
				resolve();
			}
			steerReservationWaiters.clear();
		}
	};
	const disposeSession = () => {
		isDisposed = true;
		acceptsSteeredUserMessages = false;
		turnInput.clear();
		steerAcceptancesByMessageId.clear();
		persister.discardPending?.();
		broadcast.close();
		if (controllers.get(streamKey) === session) {
			controllers.delete(streamKey);
		}
	};

	const session = {
		abort(reason) {
			abortController.abort(reason);
		},
		abortSignal: abortController.signal,
		acceptSteeredUserMessage(message, acceptance = null) {
			if (!acceptsSteeredUserMessages) {
				return false;
			}
			return attachSteeredUserMessage(message, acceptance);
		},
		closeSteeredUserMessageAcceptance() {
			acceptsSteeredUserMessages = false;
		},
		openSteeredUserMessageAcceptance() {
			if (!isDisposed && !abortController.signal.aborted) {
				acceptsSteeredUserMessages = true;
			}
		},
		reserveSteeredUserMessageAcceptance() {
			if (!acceptsSteeredUserMessages) {
				return null;
			}
			outstandingSteerReservations += 1;
			let released = false;
			let attached = false;
			return {
				accept(message, acceptance = null) {
					if (released || attached || isDisposed) {
						return false;
					}
					attached = true;
					return attachSteeredUserMessage(message, acceptance);
				},
				release() {
					if (released) {
						return;
					}
					released = true;
					releaseSteerReservation();
				},
			};
		},
		persister,
		streamKey,
		turnInput,
		async start() {
			await persister.start();
			const existingSession = controllers.get(streamKey);
			if (existingSession && !existingSession.isBroadcastClosed?.()) {
				existingSession.transferPendingInputTo(session);
				existingSession.abort("superseded");
				existingSession.cleanup?.();
			}
			controllers.set(streamKey, session);
		},
		isBroadcastClosed() {
			return broadcast.isClosed();
		},
		append(delta) {
			persister.append(delta);
		},
		replaceParts(parts) {
			persister.replaceParts(parts);
		},
		async startToolCall(args) {
			await persister.startToolCall?.(args);
		},
		async finishToolCall(args) {
			await persister.finishToolCall?.(args);
		},
		async transitionGeneration(args) {
			await persister.transitionGeneration?.(args);
		},
		discardPending() {
			persister.discardPending?.();
		},
		async closePersistence() {
			await persister.closePersistence();
		},
		async finish() {
			try {
				await persister.finish();
			} finally {
				broadcast.close();
				if (controllers.get(streamKey) === session) {
					controllers.delete(streamKey);
				}
			}
		},
		cleanup() {
			if (retainsSessionForDurableStop) {
				return;
			}
			disposeSession();
		},
		beginDurableStop() {
			retainsSessionForDurableStop = true;
			acceptsSteeredUserMessages = false;
		},
		commitDurableStop() {
			if (!retainsSessionForDurableStop) {
				throw new Error("Durable stop was not prepared.");
			}
			for (const acceptance of preparedDurableStopBoundary?.steerAcceptances ??
				[]) {
				steerAcceptancesByMessageId.delete(acceptance.messageId);
			}
			preparedDurableStopBoundary = null;
			retainsSessionForDurableStop = false;
			disposeSession();
		},
		prepareDurableStopBoundary() {
			if (!retainsSessionForDurableStop) {
				throw new Error("Durable stop was not started.");
			}
			if (preparedDurableStopBoundary) {
				return preparedDurableStopBoundary;
			}
			const boundary = turnInput.takeSteerGenerationBoundary();
			const messages = [
				...boundary.consumed.flatMap((batch) => batch.input),
				...boundary.pending,
			];
			const steerAcceptances = messages.flatMap((message) => {
				const acceptance = steerAcceptancesByMessageId.get(message.id);
				return acceptance ? [acceptance] : [];
			});
			preparedDurableStopBoundary = Object.freeze({
				consumed: Object.freeze(
					boundary.consumed.map((batch) =>
						Object.freeze({
							input: Object.freeze([...batch.input]),
							stepNumber: batch.stepNumber,
						}),
					),
				),
				deferredInput: Object.freeze([...turnInput.takeForCurrentTurn()]),
				pending: Object.freeze([...boundary.pending]),
				preparedAt: Date.now(),
				steerAcceptances: Object.freeze([...steerAcceptances]),
			});
			return preparedDurableStopBoundary;
		},
		takePendingSteeredUserMessages(stepNumber) {
			return turnInput.takeSteerInput(stepNumber);
		},
		takeSteeredUserMessageGenerationBoundary() {
			const boundary = turnInput.takeSteerGenerationBoundary();
			const messages = [
				...boundary.consumed.flatMap((batch) => batch.input),
				...boundary.pending,
			];
			const steerAcceptances = messages.flatMap((message) => {
				const acceptance = steerAcceptancesByMessageId.get(message.id);
				steerAcceptancesByMessageId.delete(message.id);
				return acceptance ? [acceptance] : [];
			});
			return {
				...boundary,
				steerAcceptances,
			};
		},
		transferPendingInputTo(targetSession) {
			const transfer = turnInput.takeForReplacementByKind();
			for (const message of transfer.steer) {
				targetSession.acceptSteeredUserMessage(
					message,
					steerAcceptancesByMessageId.get(message.id),
				);
			}
			if (transfer.mailbox.length > 0) {
				targetSession.turnInput.enqueueMailboxInput(transfer.mailbox);
			}
			if (!transfer.acceptsMailboxDelivery) {
				targetSession.turnInput.deferMailboxDeliveryToNextTurn();
			}
			steerAcceptancesByMessageId.clear();
		},
		waitForSteeredUserMessageReservations() {
			if (outstandingSteerReservations === 0) {
				return Promise.resolve();
			}
			return new Promise((resolve) => {
				steerReservationWaiters.add(resolve);
			});
		},
		subscribe() {
			return broadcast.subscribe();
		},
		startBroadcast(stream) {
			return broadcast.start(stream);
		},
	};

	return session;
};

export const createHostedActiveChatStreamSession = ({
	callbacks,
	chatId,
	controllers,
	messageId = `stream-${crypto.randomUUID()}`,
	runId,
	workspaceId,
}) =>
	createHostedActiveStreamSession({
		controllers,
		streamKey: createHostedActiveStreamKey({
			workspaceId,
			chatId,
		}),
		turnInput: createHostedTurnInputBuffer(),
		persister: new HostedActiveChatStreamPersister({
			workspaceId,
			chatId,
			messageId,
			runId,
			...callbacks,
		}),
	});

const stringifyToolPayload = (payload) => {
	if (payload === undefined) {
		return undefined;
	}

	try {
		return JSON.stringify(payload);
	} catch (error) {
		throw new TypeError("Failed to serialize active stream tool payload.", {
			cause: error,
		});
	}
};

const persistHostedActiveStreamToolChunk = async ({ chunk, persister }) => {
	if (!persister) {
		return;
	}

	if (chunk.type === "tool-input-available") {
		await persister.startToolCall?.({
			toolCallId: chunk.toolCallId,
			toolName: chunk.toolName,
			input: chunk.input,
		});
		return;
	}

	if (chunk.type === "tool-input-error") {
		await persister.startToolCall?.({
			toolCallId: chunk.toolCallId,
			toolName: chunk.toolName,
			input: chunk.input,
		});
		await persister.finishToolCall?.({
			toolCallId: chunk.toolCallId,
			status: "failed",
			errorText: chunk.errorText,
		});
		return;
	}

	if (chunk.type === "tool-output-available") {
		await persister.finishToolCall?.({
			toolCallId: chunk.toolCallId,
			status: "completed",
			output: chunk.output,
		});
		return;
	}

	if (chunk.type === "tool-output-error") {
		await persister.finishToolCall?.({
			toolCallId: chunk.toolCallId,
			status: "failed",
			errorText: chunk.errorText,
		});
		return;
	}

	if (chunk.type === "tool-output-denied") {
		await persister.finishToolCall?.({
			toolCallId: chunk.toolCallId,
			status: "denied",
			errorText: chunk.errorText,
		});
	}
};

const reportHostedActiveStreamPipeError = async ({ error, onError }) => {
	if (!onError) {
		return;
	}

	await onError(error);
};

export const pipeHostedActiveStreamEvents = ({
	onError,
	onFlush,
	persister,
	stream,
}) =>
	stream.pipeThrough(
		new TransformStream({
			async transform(chunk, controller) {
				try {
					if (chunk.type === "text-delta") {
						persister?.append(chunk.delta);
					}

					await persistHostedActiveStreamToolChunk({ chunk, persister });
					controller.enqueue(chunk);
				} catch (error) {
					await reportHostedActiveStreamPipeError({ error, onError });
					throw error;
				}
			},
			async flush() {
				try {
					await persister?.flush?.();
					await onFlush?.();
				} catch (error) {
					await reportHostedActiveStreamPipeError({ error, onError });
					throw error;
				}
			},
		}),
	);

export const pipeHostedActiveStreamText = pipeHostedActiveStreamEvents;
