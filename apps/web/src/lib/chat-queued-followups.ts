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

export type QueuedFollowUpChange =
	| { type: "hide"; messageId: string; restore: QueuedFollowUpSnapshot | null }
	| { type: "restore" | "save"; snapshot: QueuedFollowUpSnapshot }
	| { type: "reorder"; messageIds: string[] }
	| { type: "restore_order"; snapshot: QueuedFollowUpOrderSnapshot }
	| { type: "resume" };

const EMPTY_QUEUED_FOLLOW_UPS: Array<QueuedFollowUpMessage> = [];
type QueuedFollowUpProjection = {
	serverMessages: Array<QueuedFollowUpMessage>;
	visibleMessages: Array<QueuedFollowUpMessage>;
};
const queuedFollowUpsCache = new Map<string, QueuedFollowUpProjection>();
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
		? (queuedFollowUpsCache.get(cacheKey)?.visibleMessages ??
			EMPTY_QUEUED_FOLLOW_UPS)
		: EMPTY_QUEUED_FOLLOW_UPS;

const publishQueuedFollowUpProjection = (
	cacheKey: string,
	projection: QueuedFollowUpProjection,
) => {
	queuedFollowUpsCache.set(cacheKey, projection);
	for (const listener of queuedFollowUpsCacheListeners.get(cacheKey) ?? []) {
		listener();
	}
};

export const reconcileQueuedFollowUpsCache = (
	cacheKey: QueuedFollowUpCacheKey,
	serverMessages: Array<QueuedFollowUpMessage>,
) => {
	if (!cacheKey) return;
	const previous = queuedFollowUpsCache.get(cacheKey);
	let visibleMessages = serverMessages;
	if (previous) {
		const visibleIds = previous.visibleMessages.map((message) => message._id);
		const visibleIdSet = new Set(visibleIds);
		const serverIds: Array<QueuedFollowUpMessage["_id"]> = [];
		const hiddenIds = new Set<QueuedFollowUpMessage["_id"]>();
		for (const message of previous.serverMessages) {
			serverIds.push(message._id);
			if (!visibleIdSet.has(message._id)) hiddenIds.add(message._id);
		}
		// Rebase local Delete/Edit and reorder onto the new server rows. A changed
		// server order supersedes local order; unrelated inserts do not erase it.
		visibleMessages = restoreQueuedFollowUpOrder(
			serverMessages.filter((message) => !hiddenIds.has(message._id)),
			{
				optimisticIds: serverIds,
				previousIds: visibleIds,
			},
		);
	}
	publishQueuedFollowUpProjection(cacheKey, {
		serverMessages,
		visibleMessages,
	});
};

export const applyQueuedFollowUpChange = (
	cacheKey: QueuedFollowUpCacheKey,
	change: QueuedFollowUpChange,
) => {
	if (!cacheKey) return;
	const projection = queuedFollowUpsCache.get(cacheKey);
	if (!projection) return;
	let { serverMessages, visibleMessages } = projection;
	const restore = (snapshot: QueuedFollowUpSnapshot) => {
		const message = serverMessages.find(
			(row) => row._id === snapshot.message._id,
		);
		// Restore the current server row, never a stale or already-consumed copy.
		return message
			? restoreQueuedFollowUp(visibleMessages, { ...snapshot, message })
			: visibleMessages;
	};
	switch (change.type) {
		case "hide":
			if (change.restore) visibleMessages = restore(change.restore);
			visibleMessages = visibleMessages.filter(
				(message) => message._id !== change.messageId,
			);
			break;
		case "restore":
			visibleMessages = restore(change.snapshot);
			break;
		case "save": {
			const { message, index } = change.snapshot;
			if (!serverMessages.some((row) => row._id === message._id)) return;
			serverMessages = serverMessages.map((row) =>
				row._id === message._id ? message : row,
			);
			visibleMessages = visibleMessages.filter(
				(row) => row._id !== message._id,
			);
			visibleMessages.splice(index, 0, message);
			break;
		}
		case "reorder":
			visibleMessages = reorderQueuedFollowUps(
				visibleMessages,
				change.messageIds,
			);
			break;
		case "restore_order":
			visibleMessages = restoreQueuedFollowUpOrder(
				visibleMessages,
				change.snapshot,
			);
			break;
		case "resume":
			visibleMessages = visibleMessages.map((message) =>
				message.status === "paused" && message.pauseReason === "interrupted"
					? { ...message, status: "queued" }
					: message,
			);
			break;
	}
	publishQueuedFollowUpProjection(cacheKey, {
		serverMessages,
		visibleMessages,
	});
};

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
			const projection = queuedFollowUpsCache.get(cacheKey);
			if (projection) {
				// Navigation must not leave an editor draft hidden in the shared cache.
				queuedFollowUpsCache.set(cacheKey, {
					...projection,
					visibleMessages: projection.serverMessages,
				});
			}
		}
	};
};

export const resetQueuedFollowUpsCacheForTest = () => {
	queuedFollowUpsCache.clear();
	queuedFollowUpsCacheListeners.clear();
};
