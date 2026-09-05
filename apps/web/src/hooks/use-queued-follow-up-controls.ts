import { captureQueuedMessagePosition } from "@workspace/ai/queued-message-position";
import { useMutation } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import type { QueuedFollowUpBarItem } from "@/components/chat/chat-queued-follow-up-bar";
import type { AttachableAssistantRunQueryResult } from "@/lib/attachable-assistant-run";
import {
	type QueuedFollowUpChange,
	type QueuedFollowUpMessage,
	type QueuedFollowUpOrderSnapshot,
	type QueuedFollowUpSnapshot,
	reorderQueuedFollowUps,
} from "@/lib/chat-queued-followups";
import type { ChatRequestContext } from "@/lib/chat-request-preparation";
import { getCachedConvexToken } from "@/lib/convex-token";
import type { FollowUpBehavior } from "@/lib/follow-up-behavior";
import { logError } from "@/lib/logger";
import type { QueuedChatSendMessage } from "@/lib/queued-chat-intent";
import type {
	QueuedChatSendIntent,
	QueuedChatSession,
} from "@/lib/queued-chat-session";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

import { useQueuedMessageEdit } from "./use-queued-message-edit";

export const useQueuedFollowUpControls = ({
	session,
	activeRun,
	chatId,
	contextLabel,
	isQueueHandoffPending,
	followUpBehavior,
	isUpdatingFollowUpBehavior,
	latestRequestBodyRef,
	localMessageIds,
	steerMessageIds,
	onEditMessage,
	onFollowUpBehaviorChange,
	queuedMessages,
	sendMessage,
	changeQueuedMessages,
	workspaceId,
}: {
	session: QueuedChatSession;
	activeRun: AttachableAssistantRunQueryResult;
	chatId: string;
	contextLabel: string;
	isQueueHandoffPending: boolean;
	followUpBehavior: FollowUpBehavior;
	isUpdatingFollowUpBehavior: boolean;
	latestRequestBodyRef: React.MutableRefObject<ChatRequestContext | null>;
	localMessageIds: ReadonlySet<string>;
	steerMessageIds: readonly string[];
	onEditMessage: (message: QueuedFollowUpMessage) => void;
	onFollowUpBehaviorChange: (behavior: FollowUpBehavior) => void;
	queuedMessages: Array<QueuedFollowUpMessage>;
	sendMessage: QueuedChatSendMessage;
	changeQueuedMessages: (change: QueuedFollowUpChange) => void;
	workspaceId: Id<"workspaces"> | null | undefined;
}) => {
	const discardQueuedMessage = useMutation(
		api.assistantQueuedMessages.discardQueued,
	);
	const reorderQueuedMessages = useMutation(
		api.assistantQueuedMessages.reorderQueuedForChat,
	);
	const resumeInterruptedQueuedMessages = useMutation(
		api.assistantQueuedMessages.resumeInterruptedForChat,
	);
	const { sending } = React.useSyncExternalStore(
		session.subscribe,
		session.getSnapshot,
		session.getSnapshot,
	);
	const sendingNowId = sending?.type === "row_action" ? sending.id : null;
	const [isResuming, setIsResuming] = React.useState(false);
	const latestReorderOperationRef = React.useRef(0);
	const {
		editDraft,
		handleEdit,
		finishQueuedMessageEdit,
		restoreEditedQueuedMessage,
		isQueuedMessageEditCurrent,
	} = useQueuedMessageEdit({ chatId, workspaceId, onEditMessage });

	const sendQueuedMessage = React.useCallback(
		async (intent: QueuedChatSendIntent) => {
			const { queuedMessage } = intent;
			if (!workspaceId) {
				return;
			}
			if (
				isQueueHandoffPending &&
				(intent.type !== "steer" || intent.origin !== "automatic")
			) {
				return;
			}
			if (
				queuedMessage.status === "paused" &&
				queuedMessage.pauseReason === "interrupted"
			)
				return;
			if (intent.type === "steer" && queuedMessage.status !== "queued") return;
			const result = await session.send(intent, {
				hasMessageId: (messageId) => localMessageIds.has(messageId),
				resolveConvexToken: getCachedConvexToken,
				sendMessage,
				setLatestRequestBody: (body) => {
					latestRequestBodyRef.current = body;
				},
				steerMessageIds,
			});
			if (result.status === "failed") {
				logError({
					event: "client.error",
					error: result.error,
					message: result.accepted
						? `Queued ${contextLabel} message was accepted, but its response stream failed`
						: `Failed to send queued ${contextLabel} message now`,
				});
				toast.error(
					result.accepted
						? "Queued message was accepted, but its response stream disconnected."
						: result.error instanceof Error
							? result.error.message
							: "Failed to send queued message now",
				);
			}
		},
		[
			session,
			contextLabel,
			isQueueHandoffPending,
			latestRequestBodyRef,
			localMessageIds,
			steerMessageIds,
			sendMessage,
			workspaceId,
		],
	);
	const handleSendNow = React.useCallback(
		async (queuedMessageId: string) => {
			const queuedMessage = queuedMessages.find(
				(message) => message._id === queuedMessageId,
			);
			if (!queuedMessage) {
				return;
			}

			const canSteer =
				queuedMessage.status === "queued" && activeRun?.status === "running";
			if (activeRun && !canSteer) {
				return;
			}

			await sendQueuedMessage(
				canSteer
					? {
							type: "steer",
							origin: "manual",
							queuedMessage,
							runId: activeRun._id,
						}
					: { type: "replay", origin: "manual", queuedMessage },
			);
		},
		[activeRun, queuedMessages, sendQueuedMessage],
	);
	const steerQueuedFollowUp = React.useCallback(
		(queuedMessage: QueuedFollowUpMessage) =>
			sendQueuedMessage({
				type: "steer",
				origin: "automatic",
				queuedMessage,
				runId: queuedMessage.runId,
			}),
		[sendQueuedMessage],
	);

	const handleResume = React.useCallback(async () => {
		if (!workspaceId || isResuming) {
			return;
		}

		const interruptedMessages = queuedMessages.filter(
			(message) =>
				message.status === "paused" && message.pauseReason === "interrupted",
		);
		if (interruptedMessages.length === 0) {
			return;
		}

		setIsResuming(true);
		try {
			await resumeInterruptedQueuedMessages({ workspaceId, chatId });
			changeQueuedMessages({ type: "resume" });
		} catch (error) {
			logError({
				event: "client.error",
				error,
				message: `Failed to resume queued ${contextLabel} messages`,
			});
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to resume queued messages",
			);
		} finally {
			setIsResuming(false);
		}
	}, [
		chatId,
		contextLabel,
		isResuming,
		queuedMessages,
		resumeInterruptedQueuedMessages,
		changeQueuedMessages,
		workspaceId,
	]);

	const handleDelete = React.useCallback(
		async (queuedMessageId: string) => {
			const queuedMessageIndex = queuedMessages.findIndex(
				(message) => message._id === queuedMessageId,
			);
			if (queuedMessageIndex < 0) {
				return;
			}
			if (!workspaceId) {
				toast.error("Workspace is not ready");
				return;
			}

			const queuedMessage = queuedMessages[queuedMessageIndex];
			const snapshot: QueuedFollowUpSnapshot = {
				position: captureQueuedMessagePosition(
					queuedMessages.map((message) => message._id),
					queuedMessage._id,
				),
				message: queuedMessage,
			};
			changeQueuedMessages({
				type: "hide",
				messageId: queuedMessage._id,
			});
			try {
				await discardQueuedMessage({
					workspaceId,
					chatId,
					queuedMessageId: queuedMessage._id,
				});
			} catch (error) {
				changeQueuedMessages({ type: "restore", snapshot });
				logError({
					event: "client.error",
					error,
					message: `Failed to delete queued ${contextLabel} message`,
				});
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to delete queued message",
				);
			}
		},
		[
			chatId,
			contextLabel,
			discardQueuedMessage,
			queuedMessages,
			changeQueuedMessages,
			workspaceId,
		],
	);

	const handleReorder = React.useCallback(
		(queuedMessageIds: Array<string>) => {
			if (!workspaceId) {
				return;
			}

			const reorderedMessages = reorderQueuedFollowUps(
				queuedMessages,
				queuedMessageIds,
			);
			if (reorderedMessages === queuedMessages) {
				return;
			}

			const rollbackSnapshot: QueuedFollowUpOrderSnapshot = {
				optimisticIds: reorderedMessages.map((message) => message._id),
				previousIds: queuedMessages.map((message) => message._id),
			};
			changeQueuedMessages({ type: "reorder", messageIds: queuedMessageIds });
			const reorderOperation = latestReorderOperationRef.current + 1;
			latestReorderOperationRef.current = reorderOperation;
			void reorderQueuedMessages({
				workspaceId,
				chatId,
				queuedMessageIds: reorderedMessages.map((message) => message._id),
			}).catch((error) => {
				if (latestReorderOperationRef.current === reorderOperation) {
					changeQueuedMessages({
						type: "restore_order",
						snapshot: rollbackSnapshot,
					});
				}
				logError({
					event: "client.error",
					error,
					message: `Failed to reorder queued ${contextLabel} messages`,
				});
				if (latestReorderOperationRef.current !== reorderOperation) {
					return;
				}
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to reorder queued messages",
				);
			});
		},
		[
			chatId,
			contextLabel,
			queuedMessages,
			reorderQueuedMessages,
			changeQueuedMessages,
			workspaceId,
		],
	);

	const queuedFollowUps = React.useMemo<Array<QueuedFollowUpBarItem>>(
		() =>
			queuedMessages.map((queuedMessage) => {
				const isInterrupted =
					queuedMessage.status === "paused" &&
					queuedMessage.pauseReason === "interrupted";
				const isFailed =
					queuedMessage.status === "paused" &&
					queuedMessage.pauseReason === "failed";
				const isSteer = queuedMessage.status === "queued" && Boolean(activeRun);
				const isHandoffBlocked =
					isQueueHandoffPending && queuedMessage.status === "queued";

				return {
					actionLabel:
						isInterrupted || isHandoffBlocked
							? null
							: isSteer
								? "Steer"
								: "Retry",
					helpText: isFailed
						? "Retry, edit, or delete it to continue the queue"
						: undefined,
					id: queuedMessage._id,
					isActionDisabled:
						sendingNowId !== null ||
						isInterrupted ||
						isHandoffBlocked ||
						Boolean(activeRun && (!isSteer || activeRun.status !== "running")),
					isSendingNow: sendingNowId === queuedMessage._id,
					isUpdatingFollowUpBehavior,
					followUpBehavior,
					onDelete: () => {
						void handleDelete(queuedMessage._id);
					},
					onEdit: () => {
						void handleEdit(queuedMessage._id);
					},
					onFollowUpBehaviorChange,
					onSendNow: () => {
						void handleSendNow(queuedMessage._id);
					},
					pauseReason:
						queuedMessage.status === "paused"
							? queuedMessage.pauseReason
							: undefined,
					text: queuedMessage.text,
					statusLabel: queuedMessage.status === "paused" ? "Paused" : "Queued",
				};
			}),
		[
			activeRun,
			followUpBehavior,
			handleDelete,
			handleEdit,
			handleSendNow,
			isQueueHandoffPending,
			isUpdatingFollowUpBehavior,
			onFollowUpBehaviorChange,
			queuedMessages,
			sendingNowId,
		],
	);

	return {
		editDraft,
		finishQueuedMessageEdit,
		isQueuedMessageEditCurrent,
		isResumingQueuedFollowUps: isResuming,
		onQueuedFollowUpsReorder: handleReorder,
		onQueuedFollowUpsResume: handleResume,
		queuedFollowUps,
		restoreEditedQueuedMessage,
		sendQueuedFollowUpNow: handleSendNow,
		steerQueuedFollowUp,
	};
};
