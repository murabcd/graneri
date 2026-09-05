import { useQuery } from "convex/react";
import * as React from "react";
import {
	applyQueuedFollowUpChange,
	getQueuedFollowUpCacheKey,
	type QueuedFollowUpChange,
	readQueuedFollowUpsCache,
	reconcileQueuedFollowUpsCache,
	subscribeQueuedFollowUpsCache,
} from "@/lib/chat-queued-followups";
import type { QueuedChatSession } from "@/lib/queued-chat-session";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export const useQueuedFollowUpProjection = ({
	session,
	chatId,
	workspaceId,
}: {
	session: QueuedChatSession;
	chatId: string;
	workspaceId: Id<"workspaces"> | null | undefined;
}) => {
	const queuedMessages = useQuery(
		api.assistantQueuedMessages.listQueuedForChat,
		workspaceId ? { workspaceId, chatId } : "skip",
	);
	const queuedMessagesCacheKey = React.useMemo(
		() => getQueuedFollowUpCacheKey({ workspaceId, chatId }),
		[chatId, workspaceId],
	);
	const getVisibleQueuedMessagesSnapshot = React.useCallback(
		() => readQueuedFollowUpsCache(queuedMessagesCacheKey),
		[queuedMessagesCacheKey],
	);
	const subscribeVisibleQueuedMessages = React.useCallback(
		(listener: () => void) =>
			subscribeQueuedFollowUpsCache(queuedMessagesCacheKey, listener),
		[queuedMessagesCacheKey],
	);
	const visibleQueuedMessages = React.useSyncExternalStore(
		subscribeVisibleQueuedMessages,
		getVisibleQueuedMessagesSnapshot,
		getVisibleQueuedMessagesSnapshot,
	);
	const { acceptedIds } = React.useSyncExternalStore(
		session.subscribe,
		session.getSnapshot,
		session.getSnapshot,
	);

	React.useEffect(() => {
		if (!queuedMessagesCacheKey || !queuedMessages) {
			return;
		}

		reconcileQueuedFollowUpsCache(
			queuedMessagesCacheKey,
			queuedMessages.filter((message) => !acceptedIds.has(message._id)),
		);
		session.reconcileAccepted(queuedMessages);
	}, [acceptedIds, session, queuedMessages, queuedMessagesCacheKey]);

	const changeQueuedMessages = React.useCallback(
		(change: QueuedFollowUpChange) => {
			applyQueuedFollowUpChange(queuedMessagesCacheKey, change);
		},
		[queuedMessagesCacheKey],
	);

	return {
		queuedMessages: visibleQueuedMessages,
		changeQueuedMessages,
	};
};
