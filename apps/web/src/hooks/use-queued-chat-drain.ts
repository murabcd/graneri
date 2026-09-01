import { useQuery } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import type { AttachableAssistantRunQueryResult } from "@/lib/attachable-assistant-run";
import {
	getQueuedFollowUpCacheKey,
	QUEUED_FOLLOW_UP_DRAIN_RETRY_MS,
	type QueuedFollowUpMessage,
	readQueuedFollowUpsCache,
	shouldDrainQueuedFollowUp,
	subscribeQueuedFollowUpsCache,
	updateQueuedFollowUpsCache,
	writeQueuedFollowUpsCache,
} from "@/lib/chat-queued-followups";
import type { ChatRequestContext } from "@/lib/chat-request-preparation";
import { getCachedConvexToken } from "@/lib/convex-token";
import { logError } from "@/lib/logger";
import {
	drainQueuedChatMessage,
	type QueuedChatSendMessage,
} from "@/lib/queued-chat-intent";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export const useQueuedChatDrain = ({
	acceptedQueuedMessageId,
	acceptedQueuedMessageIdsRef,
	activeRun,
	chatId,
	contextLabel,
	isBlocked,
	latestRequestBodyRef,
	localMessageIds,
	sendMessage,
	workspaceId,
}: {
	acceptedQueuedMessageId: string | null;
	acceptedQueuedMessageIdsRef: React.MutableRefObject<Set<string>>;
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
	const isDrainingQueuedMessageRef = React.useRef(false);
	const retryTimerRef = React.useRef<number | null>(null);
	const isMountedRef = React.useRef(true);
	const [retryNonce, setRetryNonce] = React.useState(0);

	React.useEffect(() => {
		if (!queuedMessagesCacheKey || !queuedMessages) {
			return;
		}

		writeQueuedFollowUpsCache(
			queuedMessagesCacheKey,
			queuedMessages.filter(
				(message) =>
					message._id !== acceptedQueuedMessageId &&
					!acceptedQueuedMessageIdsRef.current.has(message._id),
			),
		);
		for (const acceptedMessageId of acceptedQueuedMessageIdsRef.current) {
			if (
				!queuedMessages.some((message) => message._id === acceptedMessageId)
			) {
				acceptedQueuedMessageIdsRef.current.delete(acceptedMessageId);
			}
		}
	}, [
		acceptedQueuedMessageId,
		acceptedQueuedMessageIdsRef,
		queuedMessages,
		queuedMessagesCacheKey,
	]);

	const updateVisibleQueuedMessages = React.useCallback(
		(
			updater: (
				messages: Array<QueuedFollowUpMessage>,
			) => Array<QueuedFollowUpMessage>,
		) => {
			updateQueuedFollowUpsCache(queuedMessagesCacheKey, updater);
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
			queuedMessages?.find(
				(message) =>
					message._id !== acceptedQueuedMessageId &&
					!acceptedQueuedMessageIdsRef.current.has(message._id),
			) ?? null;
		const queuedMessage = queueHead?.status === "queued" ? queueHead : null;

		if (
			!shouldDrainQueuedFollowUp({
				activeRun,
				hasQueuedMessage: Boolean(queuedMessage),
				isBlocked,
				isDraining: isDrainingQueuedMessageRef.current,
				workspaceId,
			})
		) {
			return;
		}
		// Queue draining is driven by external run/queue state, not a local UI event.
		if (!workspaceId) {
			return;
		}

		isDrainingQueuedMessageRef.current = true;
		void (async () => {
			try {
				const drainResult = await drainQueuedChatMessage({
					// Local message ids come from the live chat state used to de-dupe drains.
					hasMessageId: (messageId) => localMessageIds.has(messageId),
					queuedMessage,
					resolveConvexToken: getCachedConvexToken,
					// Sending hands the visible queue id to the hosted route for claiming.
					sendMessage,
					setLatestRequestBody: (body) => {
						// Latest request body is stored for the next queued drain handoff.
						latestRequestBodyRef.current = body;
					},
				});
				if (drainResult.status === "retry") {
					scheduleRetry();
					return;
				}

				if (drainResult.status === "send_failed") {
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
			} catch (error) {
				logError({
					event: "client.error",
					error,
					message: `Failed to drain queued ${contextLabel} message`,
				});
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to send queued follow-up",
				);
			} finally {
				isDrainingQueuedMessageRef.current = false;
			}
		})();
	}, [
		acceptedQueuedMessageId,
		acceptedQueuedMessageIdsRef,
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
		setQueuedMessages: updateVisibleQueuedMessages,
	};
};
