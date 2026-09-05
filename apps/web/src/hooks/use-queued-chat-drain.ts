import { useQuery } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import type { AttachableAssistantRunQueryResult } from "@/lib/attachable-assistant-run";
import {
	applyQueuedFollowUpChange,
	getQueuedFollowUpCacheKey,
	QUEUED_FOLLOW_UP_DRAIN_RETRY_MS,
	type QueuedFollowUpChange,
	readQueuedFollowUpsCache,
	reconcileQueuedFollowUpsCache,
	subscribeQueuedFollowUpsCache,
} from "@/lib/chat-queued-followups";
import type { ChatRequestContext } from "@/lib/chat-request-preparation";
import { getCachedConvexToken } from "@/lib/convex-token";
import { logError } from "@/lib/logger";
import type { QueuedChatSendMessage } from "@/lib/queued-chat-intent";
import type { QueuedChatSession } from "@/lib/queued-chat-session";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export const useQueuedChatDrain = ({
	session,
	activeRun,
	chatId,
	contextLabel,
	isBlocked,
	latestRequestBodyRef,
	localMessageIds,
	sendMessage,
	workspaceId,
}: {
	session: QueuedChatSession;
	activeRun: AttachableAssistantRunQueryResult;
	chatId: string;
	contextLabel: string;
	isBlocked: boolean;
	latestRequestBodyRef: React.MutableRefObject<ChatRequestContext | null>;
	localMessageIds: ReadonlySet<string>;
	sendMessage: QueuedChatSendMessage;
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
	const retryTimerRef = React.useRef<number | null>(null);
	const isMountedRef = React.useRef(true);
	const [retryNonce, setRetryNonce] = React.useState(0);

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

	React.useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
			if (retryTimerRef.current !== null) {
				window.clearTimeout(retryTimerRef.current);
				retryTimerRef.current = null;
			}
		};
	}, []);

	const scheduleRetry = React.useCallback(() => {
		if (!isMountedRef.current || retryTimerRef.current !== null) {
			return;
		}

		retryTimerRef.current = window.setTimeout(() => {
			retryTimerRef.current = null;
			if (!isMountedRef.current) {
				return;
			}
			setRetryNonce((current) => current + 1);
		}, QUEUED_FOLLOW_UP_DRAIN_RETRY_MS);
	}, []);

	React.useEffect(() => {
		void retryNonce;
		// The queue is ordered server-side: a paused or failed head must block later
		// rows until the user resolves it, rather than letting the drain skip ahead.
		const queueHead =
			queuedMessages?.find((message) => !acceptedIds.has(message._id)) ?? null;
		const queuedMessage = queueHead?.status === "queued" ? queueHead : null;

		if (!workspaceId || activeRun || isBlocked || !queuedMessage) return;

		void (async () => {
			const drainResult = await session.send(
				{ type: "replay", origin: "automatic", queuedMessage },
				{
					hasMessageId: (messageId) => localMessageIds.has(messageId),
					resolveConvexToken: getCachedConvexToken,
					sendMessage,
					setLatestRequestBody: (body) => {
						latestRequestBodyRef.current = body;
					},
					steerMessageIds: [],
				},
			);
			if (drainResult.status === "retry") {
				scheduleRetry();
				return;
			}

			if (drainResult.status === "failed") {
				logError({
					event: "client.error",
					error: drainResult.error,
					message: `Failed to drain queued ${contextLabel} message`,
				});
				toast.error(
					drainResult.error instanceof Error
						? drainResult.error.message
						: "Failed to send queued follow-up",
				);
			}
		})();
	}, [
		acceptedIds,
		session,
		activeRun,
		contextLabel,
		isBlocked,
		latestRequestBodyRef,
		localMessageIds,
		queuedMessages,
		retryNonce,
		scheduleRetry,
		sendMessage,
		workspaceId,
	]);

	return {
		queuedMessages: visibleQueuedMessages,
		changeQueuedMessages,
	};
};
