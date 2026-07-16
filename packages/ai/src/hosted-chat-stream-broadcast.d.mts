export declare const HOSTED_STREAM_MAX_REPLAY_BYTES: number;
export declare const HOSTED_STREAM_MAX_REPLAY_CHUNKS: number;
export declare const HOSTED_STREAM_MAX_SUBSCRIBERS: number;

export type HostedChatStreamBroadcast = {
	close(reason?: unknown): void;
	fail(error: unknown): void;
	isClosed(): boolean;
	start<Chunk>(stream: ReadableStream<Chunk>): ReadableStream<Chunk>;
	subscribe<Chunk>(): ReadableStream<Chunk>;
};

export declare const createHostedChatStreamBroadcast: () => HostedChatStreamBroadcast;
