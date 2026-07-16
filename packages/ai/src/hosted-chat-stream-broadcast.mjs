export const HOSTED_STREAM_MAX_REPLAY_BYTES = 4 * 1024 * 1024;
export const HOSTED_STREAM_MAX_REPLAY_CHUNKS = 512;
export const HOSTED_STREAM_MAX_SUBSCRIBERS = 4;

const REPLAY_UNAVAILABLE_MESSAGE =
	"Active stream replay capacity was exceeded. Wait for the persisted response to finish.";
const SUBSCRIBER_LIMIT_MESSAGE =
	"Active stream subscriber capacity was exceeded.";
const textEncoder = new TextEncoder();

const replayCoalescibleDeltaTypes = new Set([
	"reasoning-delta",
	"text-delta",
	"tool-input-delta",
]);

const getSerializedByteLength = (value) => {
	try {
		const serialized = JSON.stringify(value);
		return serialized === undefined
			? Number.POSITIVE_INFINITY
			: textEncoder.encode(serialized).byteLength;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
};

const getSerializedStringContentByteLength = (value) => {
	const serializedBytes = getSerializedByteLength(value);
	return Number.isFinite(serializedBytes)
		? Math.max(0, serializedBytes - 2)
		: serializedBytes;
};

const appendReplayChunk = (replay, chunk) => {
	if (!replay.available) {
		return;
	}

	const previousChunk = replay.chunks.at(-1);
	const chunkId = chunk?.id ?? chunk?.toolCallId;
	const previousChunkId = previousChunk?.id ?? previousChunk?.toolCallId;
	const shouldCoalesce =
		replayCoalescibleDeltaTypes.has(chunk?.type) &&
		chunkId &&
		chunkId === previousChunkId &&
		chunk?.type === previousChunk?.type &&
		typeof chunk.delta === "string" &&
		typeof previousChunk.delta === "string";
	const nextChunk = shouldCoalesce
		? { ...previousChunk, delta: previousChunk.delta + chunk.delta }
		: chunk;
	const previousChunkBytes = shouldCoalesce ? (replay.sizes.at(-1) ?? 0) : 0;
	const nextChunkBytes = shouldCoalesce
		? previousChunkBytes + getSerializedStringContentByteLength(chunk.delta)
		: getSerializedByteLength(nextChunk);
	const nextBytes = replay.bytes - previousChunkBytes + nextChunkBytes;
	const nextChunkCount = replay.chunks.length + (shouldCoalesce ? 0 : 1);

	if (
		nextBytes > HOSTED_STREAM_MAX_REPLAY_BYTES ||
		nextChunkCount > HOSTED_STREAM_MAX_REPLAY_CHUNKS
	) {
		replay.available = false;
		replay.bytes = 0;
		replay.chunks.length = 0;
		replay.sizes.length = 0;
		return;
	}

	replay.bytes = nextBytes;
	if (shouldCoalesce) {
		replay.chunks[replay.chunks.length - 1] = nextChunk;
		replay.sizes[replay.sizes.length - 1] = nextChunkBytes;
		return;
	}

	replay.chunks.push(nextChunk);
	replay.sizes.push(nextChunkBytes);
};

const createErroredStream = (message) =>
	new ReadableStream({
		start(controller) {
			controller.error(new Error(message));
		},
	});

export const createHostedChatStreamBroadcast = () => {
	const subscribers = new Set();
	const capacityWaiters = new Set();
	const replay = {
		available: true,
		bytes: 0,
		chunks: [],
		sizes: [],
	};
	let broadcastStarted = false;
	let broadcastClosed = false;
	let broadcastError = null;
	let activeReader = null;

	const notifyCapacityChanged = () => {
		for (const resolve of capacityWaiters) {
			resolve();
		}
		capacityWaiters.clear();
	};

	const removeSubscriber = (subscriber) => {
		if (!subscriber.closed) {
			subscriber.closed = true;
			subscribers.delete(subscriber);
			notifyCapacityChanged();
		}
	};

	const closeSubscriber = (subscriber) => {
		if (subscriber.closed) {
			return;
		}
		subscriber.controller.close();
		removeSubscriber(subscriber);
	};

	const hasBroadcastCapacity = () =>
		Array.from(
			subscribers,
			(subscriber) =>
				subscriber.replayIndex >= subscriber.replayChunks.length &&
				(subscriber.controller.desiredSize ?? 0) > 0,
		).every(Boolean);

	const waitForBroadcastCapacity = async () => {
		while (!broadcastClosed && !hasBroadcastCapacity()) {
			await new Promise((resolve) => {
				capacityWaiters.add(resolve);
			});
		}
	};

	const complete = () => {
		if (broadcastClosed) {
			return;
		}
		broadcastClosed = true;
		for (const subscriber of subscribers) {
			if (subscriber.replayIndex >= subscriber.replayChunks.length) {
				closeSubscriber(subscriber);
			}
		}
		activeReader = null;
		notifyCapacityChanged();
	};

	const close = (reason) => {
		const reader = activeReader;
		complete();
		void reader?.cancel(reason).catch(() => undefined);
	};

	const fail = (error) => {
		if (broadcastClosed) {
			return;
		}
		const reader = activeReader;
		broadcastClosed = true;
		broadcastError = error;
		for (const subscriber of subscribers) {
			subscriber.controller.error(error);
			subscriber.closed = true;
		}
		subscribers.clear();
		activeReader = null;
		notifyCapacityChanged();
		void reader?.cancel(error).catch(() => undefined);
	};

	const subscribe = () => {
		if (broadcastError) {
			return createErroredStream(
				broadcastError instanceof Error
					? broadcastError.message
					: "Active stream failed.",
			);
		}
		if (!replay.available) {
			return createErroredStream(REPLAY_UNAVAILABLE_MESSAGE);
		}
		if (subscribers.size >= HOSTED_STREAM_MAX_SUBSCRIBERS) {
			return createErroredStream(SUBSCRIBER_LIMIT_MESSAGE);
		}

		const subscriber = {
			closed: false,
			controller: null,
			replayChunks: [...replay.chunks],
			replayIndex: 0,
		};
		return new ReadableStream(
			{
				start(controller) {
					subscriber.controller = controller;
					subscribers.add(subscriber);
				},
				pull(controller) {
					const replayChunk = subscriber.replayChunks[subscriber.replayIndex];
					if (replayChunk !== undefined) {
						controller.enqueue(replayChunk);
						subscriber.replayIndex += 1;
					}
					if (
						broadcastClosed &&
						subscriber.replayIndex >= subscriber.replayChunks.length
					) {
						closeSubscriber(subscriber);
						return;
					}
					notifyCapacityChanged();
				},
				cancel() {
					removeSubscriber(subscriber);
				},
			},
			{ highWaterMark: 1 },
		);
	};

	const publish = (chunk) => {
		appendReplayChunk(replay, chunk);
		for (const subscriber of subscribers) {
			subscriber.controller.enqueue(chunk);
		}
	};

	const start = (stream) => {
		if (broadcastStarted) {
			return subscribe();
		}
		broadcastStarted = true;
		const initialStream = subscribe();
		const reader = stream.getReader();
		activeReader = reader;
		void (async () => {
			try {
				for (;;) {
					await waitForBroadcastCapacity();
					if (broadcastClosed) {
						return;
					}
					const { done, value } = await reader.read();
					if (done) {
						complete();
						return;
					}
					await waitForBroadcastCapacity();
					if (broadcastClosed) {
						return;
					}
					publish(value);
				}
			} catch (error) {
				fail(error);
			}
		})();

		return initialStream;
	};

	return {
		close,
		fail,
		isClosed: () => broadcastClosed,
		start,
		subscribe,
	};
};
