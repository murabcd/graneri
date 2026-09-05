import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type QueuedFollowUpMessage = NonNullable<
	FunctionReturnType<typeof api.assistantQueuedMessages.listQueuedForChat>
>[number];
export type QueuedFollowUpSnapshot = {
	index: number;
	message: QueuedFollowUpMessage;
};
export type QueuedFollowUpOrderSnapshot = {
	optimisticIds: Array<QueuedFollowUpMessage["_id"]>;
	previousIds: Array<QueuedFollowUpMessage["_id"]>;
};

export type QueuedFollowUpCacheKey = string | null;

const EMPTY_QUEUED_FOLLOW_UPS: Array<QueuedFollowUpMessage> = [];
const queuedFollowUpsCache = new Map<string, Array<QueuedFollowUpMessage>>();
const queuedFollowUpsCacheListeners = new Map<string, Set<() => void>>();

export const QUEUED_FOLLOW_UP_DRAIN_RETRY_MS = 400;

const haveSameQueuedFollowUpOrder = (
	left: Array<QueuedFollowUpMessage["_id"]>,
	right: Array<QueuedFollowUpMessage["_id"]>,
) =>
	left.length === right.length &&
	left.every((queuedMessageId, index) => queuedMessageId === right[index]);

export const reorderQueuedFollowUps = (
	messages: Array<QueuedFollowUpMessage>,
	queuedMessageIds: Array<string>,
) => {
	if (queuedMessageIds.length !== messages.length) {
		return messages;
	}

	const messagesById = new Map<string, QueuedFollowUpMessage>(
		messages.map((message) => [message._id, message]),
	);
	const seenIds = new Set<string>();
	const reorderedMessages: Array<QueuedFollowUpMessage> = [];
	for (const queuedMessageId of queuedMessageIds) {
		const message = messagesById.get(queuedMessageId);
		if (!message || seenIds.has(queuedMessageId)) {
			return messages;
		}

		seenIds.add(queuedMessageId);
		reorderedMessages.push(message);
	}

	return haveSameQueuedFollowUpOrder(
		messages.map((message) => message._id),
		reorderedMessages.map((message) => message._id),
	)
		? messages
		: reorderedMessages;
};

export const restoreQueuedFollowUp = (
	messages: Array<QueuedFollowUpMessage>,
	snapshot: QueuedFollowUpSnapshot,
) => {
	if (messages.some((message) => message._id === snapshot.message._id)) {
		return messages;
	}

	const nextMessages = [...messages];
	nextMessages.splice(snapshot.index, 0, snapshot.message);
	return nextMessages;
};

export const restoreQueuedFollowUpOrder = (
	messages: Array<QueuedFollowUpMessage>,
	snapshot: QueuedFollowUpOrderSnapshot,
) => {
	const previousIdSet = new Set(snapshot.previousIds);
	const currentMessageIds = new Set(messages.map((message) => message._id));
	const currentOriginalIds: Array<QueuedFollowUpMessage["_id"]> = [];
	for (const message of messages) {
		if (previousIdSet.has(message._id)) {
			currentOriginalIds.push(message._id);
		}
	}
	const optimisticSurvivorIds = snapshot.optimisticIds.filter(
		(queuedMessageId) => currentMessageIds.has(queuedMessageId),
	);
	if (!haveSameQueuedFollowUpOrder(currentOriginalIds, optimisticSurvivorIds)) {
		return messages;
	}

	const messagesById = new Map(
		messages.map((message) => [message._id, message]),
	);
	const previousSurvivors: Array<QueuedFollowUpMessage> = [];
	for (const queuedMessageId of snapshot.previousIds) {
		const message = messagesById.get(queuedMessageId);
		if (message) {
			previousSurvivors.push(message);
		}
	}
	let survivorIndex = 0;
	return messages.map((message) => {
		if (!previousIdSet.has(message._id)) {
			return message;
		}

		const restoredMessage = previousSurvivors[survivorIndex];
		survivorIndex += 1;
		return restoredMessage ?? message;
	});
};

export const getQueuedFollowUpCacheKey = ({
	chatId,
	workspaceId,
}: {
	chatId: string;
	workspaceId: Id<"workspaces"> | null | undefined;
}): QueuedFollowUpCacheKey => (workspaceId ? `${workspaceId}:${chatId}` : null);

export const readQueuedFollowUpsCache = (cacheKey: QueuedFollowUpCacheKey) =>
	cacheKey
		? (queuedFollowUpsCache.get(cacheKey) ?? EMPTY_QUEUED_FOLLOW_UPS)
		: EMPTY_QUEUED_FOLLOW_UPS;

export const writeQueuedFollowUpsCache = (
	cacheKey: QueuedFollowUpCacheKey,
	messages: Array<QueuedFollowUpMessage>,
) => {
	if (!cacheKey) {
		return;
	}

	queuedFollowUpsCache.set(cacheKey, messages);
	for (const listener of queuedFollowUpsCacheListeners.get(cacheKey) ?? []) {
		listener();
	}
};

export const updateQueuedFollowUpsCache = (
	cacheKey: QueuedFollowUpCacheKey,
	updater: (
		messages: Array<QueuedFollowUpMessage>,
	) => Array<QueuedFollowUpMessage>,
) =>
	writeQueuedFollowUpsCache(
		cacheKey,
		updater(readQueuedFollowUpsCache(cacheKey)),
	);

export const subscribeQueuedFollowUpsCache = (
	cacheKey: QueuedFollowUpCacheKey,
	listener: () => void,
) => {
	if (!cacheKey) {
		return () => undefined;
	}

	const listeners = queuedFollowUpsCacheListeners.get(cacheKey) ?? new Set();
	listeners.add(listener);
	queuedFollowUpsCacheListeners.set(cacheKey, listeners);

	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			queuedFollowUpsCacheListeners.delete(cacheKey);
		}
	};
};

export const resetQueuedFollowUpsCacheForTest = () => {
	queuedFollowUpsCache.clear();
	queuedFollowUpsCacheListeners.clear();
};
