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
	#parts = null;
	#runId;
	#startActiveStream;
	#startActiveStreamToolCall;
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
		this.#updateActiveStream = updateActiveStream;
		this.#workspaceId = workspaceId;
	}

	get messageId() {
		return this.#messageId;
	}

	get runId() {
		return this.#runId;
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

		this.#parts = parts;
		this.#scheduleFlush();
	}

	#scheduleFlush() {
		if (this.#flushTimer) {
			return;
		}

		this.#flushTimer = setTimeout(() => {
			this.#flushTimer = null;
			void this.flush().catch((error) => {
				this.#flushError = error;
			});
		}, HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS);
	}

	async startToolCall({ input, toolCallId, toolName }) {
		await this.#startActiveStreamToolCall({
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			runId: this.#runId,
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
			toolCallId,
			status,
			outputJson: stringifyToolPayload(output),
			errorText,
		});
	}

	async flush() {
		if (this.#discarded) {
			return;
		}

		if (this.#flushError) {
			const error = this.#flushError;
			this.#flushError = null;
			throw error;
		}

		if (this.#flushTimer) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = null;
		}

		while (this.#buffer || this.#parts !== null) {
			const delta = this.#buffer;
			this.#buffer = "";
			const parts = this.#parts;
			this.#parts = null;
			const previousFlush = this.#flushPromise ?? Promise.resolve();
			const flushPromise = previousFlush
				.then(async () => {
					if (this.#discarded) {
						return undefined;
					}
					await this.#updateActiveStream({
						workspaceId: this.#workspaceId,
						chatId: this.#chatId,
						runId: this.#runId,
						...(delta ? { delta } : {}),
						...(parts === null
							? {}
							: { partsJson: stringifyToolPayload(parts) }),
					});
					return undefined;
				})
				.then(() => undefined);

			this.#flushPromise = flushPromise;
			try {
				await flushPromise;
			} finally {
				if (this.#flushPromise === flushPromise) {
					this.#flushPromise = null;
				}
			}
		}

		await this.#flushPromise;

		if (this.#flushError) {
			const error = this.#flushError;
			this.#flushError = null;
			throw error;
		}
	}

	async finish() {
		await this.flush();
		if (this.#discarded) {
			return;
		}

		await this.#finishActiveStream({
			workspaceId: this.#workspaceId,
			chatId: this.#chatId,
			runId: this.#runId,
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

	const session = {
		abort(reason) {
			abortController.abort(reason);
		},
		abortSignal: abortController.signal,
		persister,
		streamKey,
		turnInput,
		async start() {
			const existingSession = controllers.get(streamKey);
			if (existingSession && !existingSession.isBroadcastClosed?.()) {
				session.turnInput.extendSteerInput(
					existingSession.turnInput.takeAllForReplacement(),
				);
				existingSession.abort("superseded");
				existingSession.cleanup?.();
			}
			controllers.set(streamKey, session);
			await persister.start();
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
			turnInput.clear();
			persister.discardPending?.();
			broadcast.close();
			if (controllers.get(streamKey) === session) {
				controllers.delete(streamKey);
			}
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
