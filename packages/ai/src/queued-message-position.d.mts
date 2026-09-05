export declare const captureQueuedMessagePosition: <MessageId extends string>(
	messageIds: readonly MessageId[],
	messageId: MessageId,
) => {
	index: number;
	previousMessageId: MessageId | null;
	nextMessageId: MessageId | null;
};
export type QueuedMessagePosition = ReturnType<
	typeof captureQueuedMessagePosition
>;
export declare const resolveQueuedMessagePosition: (
	messageIds: readonly string[],
	position: QueuedMessagePosition,
) => number;
