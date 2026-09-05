export const captureQueuedMessagePosition = (messageIds, messageId) => {
	const index = messageIds.indexOf(messageId);
	if (index === -1)
		throw new Error("Queued message is missing from its queue.");
	return {
		index,
		previousMessageId: messageIds[index - 1] ?? null,
		nextMessageId: messageIds[index + 1] ?? null,
	};
};

export const resolveQueuedMessagePosition = (messageIds, position) => {
	const next = messageIds.indexOf(position.nextMessageId);
	if (next !== -1) return next;
	const previous = messageIds.indexOf(position.previousMessageId);
	if (previous !== -1) return previous + 1;
	return Math.min(Math.max(position.index, 0), messageIds.length);
};
