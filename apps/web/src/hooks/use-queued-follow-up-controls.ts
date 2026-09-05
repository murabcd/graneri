import { useMutation } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import type { QueuedFollowUpBarItem } from "@/components/chat/chat-queued-follow-up-bar";
import type { AttachableAssistantRunQueryResult } from "@/lib/attachable-assistant-run";
import {
	type QueuedFollowUpMessage,
	type QueuedFollowUpOrderSnapshot,
	type QueuedFollowUpSnapshot,
	reorderQueuedFollowUps,
	restoreQueuedFollowUp,
	restoreQueuedFollowUpOrder,
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

type SetQueuedMessages = (
	updater: (
		messages: Array<QueuedFollowUpMessage>,
	) => Array<QueuedFollowUpMessage>,
) => void;
type QueuedMessageSendIntent = Exclude<
	QueuedChatSendIntent,
	{ type: "replay"; origin: "automatic" }
>;

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
	setQueuedMessages,
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
	setQueuedMessages: SetQueuedMessages;
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
	const [editingId, setEditingId] = React.useState<string | null>(null);
	const [editDraft, setEditDraft] =
		React.useState<QueuedFollowUpSnapshot | null>(null);
	const editingIdRef = React.useRef<string | null>(null);
	const latestReorderOperationRef = React.useRef(0);
	const restoreEditedQueuedMessage = React.useCallback(() => {
		if (!editDraft) {
			return;
		}

		editingIdRef.current = null;
		setQueuedMessages((messages) => restoreQueuedFollowUp(messages, editDraft));
		setEditDraft(null);
		setEditingId(null);
	}, [editDraft, setQueuedMessages]);

	const finishQueuedMessageEdit = React.useCallback(
		(updatedQueuedMessage: QueuedFollowUpMessage) => {
			if (!editDraft) {
				return false;
			}

			setQueuedMessages((messages) => {
				const nextMessages = messages.filter(
					(message) => message._id !== updatedQueuedMessage._id,
				);
				nextMessages.splice(editDraft.index, 0, updatedQueuedMessage);
				return nextMessages;
			});

			if (editingIdRef.current !== updatedQueuedMessage._id) {
				return false;
			}

			editingIdRef.current = null;
			setEditDraft((currentDraft) =>
				currentDraft?.message._id === updatedQueuedMessage._id
					? null
					: currentDraft,
			);
			setEditingId((currentEditingId) =>
				currentEditingId === updatedQueuedMessage._id ? null : currentEditingId,
			);
			return true;
		},
		[editDraft, setQueuedMessages],
	);
	const isQueuedMessageEditCurrent = React.useCallback(
		(queuedMessageId: string) => editingIdRef.current === queuedMessageId,
		[],
	);

	const sendQueuedMessage = React.useCallback(
		async (intent: QueuedMessageSendIntent) => {
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
			setQueuedMessages((messages) =>
				messages.map((message) =>
					message.status === "paused" && message.pauseReason === "interrupted"
						? {
								...message,
								status: "queued",
							}
						: message,
				),
			);
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
		setQueuedMessages,
		workspaceId,
	]);

	const handleEdit = React.useCallback(
		(queuedMessageId: string) => {
			const queuedMessageIndex = queuedMessages.findIndex(
				(message) => message._id === queuedMessageId,
			);
			if (queuedMessageIndex < 0) {
				return;
			}

			const queuedMessage = queuedMessages[queuedMessageIndex];
			editingIdRef.current = queuedMessage._id;
			setEditingId(queuedMessage._id);
			setEditDraft({
				index: queuedMessageIndex,
				message: queuedMessage,
			});
			setQueuedMessages((messages) => {
				const nextMessages = editDraft
					? restoreQueuedFollowUp(messages, editDraft)
					: messages;

				return nextMessages.filter(
					(message) => message._id !== queuedMessage._id,
				);
			});
			onEditMessage(queuedMessage);
		},
		[editDraft, onEditMessage, queuedMessages, setQueuedMessages],
	);

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
				index: queuedMessageIndex,
				message: queuedMessage,
			};
			setQueuedMessages((messages) =>
				messages.filter((message) => message._id !== queuedMessage._id),
			);
			try {
				await discardQueuedMessage({
					workspaceId,
					chatId,
					queuedMessageId: queuedMessage._id,
				});
			} catch (error) {
				setQueuedMessages((messages) =>
					restoreQueuedFollowUp(messages, snapshot),
				);
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
			setQueuedMessages,
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
			setQueuedMessages(() => reorderedMessages);
			const reorderOperation = latestReorderOperationRef.current + 1;
			latestReorderOperationRef.current = reorderOperation;
			void reorderQueuedMessages({
				workspaceId,
				chatId,
				queuedMessageIds: reorderedMessages.map((message) => message._id),
			}).catch((error) => {
				if (latestReorderOperationRef.current === reorderOperation) {
					setQueuedMessages((messages) =>
						restoreQueuedFollowUpOrder(messages, rollbackSnapshot),
					);
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
			setQueuedMessages,
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
					isEditing: editingId === queuedMessage._id,
					isSendingNow: sendingNowId === queuedMessage._id,
					isUpdatingFollowUpBehavior,
					followUpBehavior,
					onDelete: () => {
						void handleDelete(queuedMessage._id);
					},
					onEdit: () => handleEdit(queuedMessage._id),
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
			editingId,
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
