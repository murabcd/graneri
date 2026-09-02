import { useMutation } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import type { QueuedFollowUpBarItem } from "@/components/chat/chat-queued-follow-up-bar";
import type { AttachableAssistantRunQueryResult } from "@/lib/attachable-assistant-run";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import type { ChatRequestContext } from "@/lib/chat-request-preparation";
import { getCachedConvexToken } from "@/lib/convex-token";
import type { FollowUpBehavior } from "@/lib/follow-up-behavior";
import { logError } from "@/lib/logger";
import {
	type BeginQueuedChatReplay,
	prepareQueuedSteerIntent,
	type QueuedChatSendMessage,
	sendQueuedChatReplay,
} from "@/lib/queued-chat-intent";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type SetQueuedMessages = (
	updater: (
		messages: Array<QueuedFollowUpMessage>,
	) => Array<QueuedFollowUpMessage>,
) => void;
type QueuedMessageEditDraft = {
	index: number;
	message: QueuedFollowUpMessage;
};
type QueuedMessageSendIntent =
	| { type: "replay"; queuedMessage: QueuedFollowUpMessage }
	| {
			type: "steer";
			origin: "automatic" | "manual";
			queuedMessage: QueuedFollowUpMessage;
			runId: Id<"assistantRuns">;
	  };

const restoreQueuedMessageAtIndex = (
	messages: Array<QueuedFollowUpMessage>,
	editDraft: QueuedMessageEditDraft,
) => {
	if (messages.some((message) => message._id === editDraft.message._id)) {
		return messages;
	}

	const nextMessages = [...messages];
	nextMessages.splice(editDraft.index, 0, editDraft.message);
	return nextMessages;
};

export const useQueuedFollowUpControls = ({
	acceptedQueuedMessageIdsRef,
	acceptedQueuedMessageId,
	activeRun,
	beginReplay,
	chatId,
	contextLabel,
	isQueueHandoffPending = false,
	followUpBehavior,
	isUpdatingFollowUpBehavior,
	latestRequestBodyRef,
	localMessageIds,
	sendingQueuedMessageIdRef,
	onSteerStart,
	onEditMessage,
	onFollowUpBehaviorChange,
	queuedMessages,
	sendMessage,
	setQueuedMessages,
	workspaceId,
}: {
	acceptedQueuedMessageIdsRef: React.MutableRefObject<Set<string>>;
	acceptedQueuedMessageId: string | null;
	activeRun: AttachableAssistantRunQueryResult;
	beginReplay: BeginQueuedChatReplay;
	chatId: string;
	contextLabel: string;
	isQueueHandoffPending?: boolean;
	followUpBehavior: FollowUpBehavior;
	isUpdatingFollowUpBehavior: boolean;
	latestRequestBodyRef: React.MutableRefObject<ChatRequestContext | null>;
	localMessageIds: ReadonlySet<string>;
	sendingQueuedMessageIdRef: React.MutableRefObject<string | null>;
	onSteerStart?: () => (() => void) | undefined;
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
	const [pendingSendingNowId, setPendingSendingNowId] = React.useState<
		string | null
	>(null);
	const sendingNowId =
		pendingSendingNowId === acceptedQueuedMessageId
			? null
			: pendingSendingNowId;
	const [isResuming, setIsResuming] = React.useState(false);
	const [editingId, setEditingId] = React.useState<string | null>(null);
	const [deletingId, setDeletingId] = React.useState<string | null>(null);
	const [editDraft, setEditDraft] =
		React.useState<QueuedMessageEditDraft | null>(null);
	const editingIdRef = React.useRef<string | null>(null);
	const restoreEditedQueuedMessage = React.useCallback(() => {
		if (!editDraft) {
			return;
		}

		editingIdRef.current = null;
		setQueuedMessages((messages) =>
			restoreQueuedMessageAtIndex(messages, editDraft),
		);
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
			const queuedMessageId = queuedMessage._id;
			if (!workspaceId) {
				return;
			}
			if (
				isQueueHandoffPending &&
				(intent.type !== "steer" || intent.origin !== "automatic")
			) {
				return;
			}
			if (sendingQueuedMessageIdRef.current !== null) {
				return;
			}
			sendingQueuedMessageIdRef.current = queuedMessageId;
			setPendingSendingNowId(queuedMessageId);
			let rollbackSteerStart: (() => void) | undefined;
			try {
				if (
					queuedMessage.status === "paused" &&
					queuedMessage.pauseReason === "interrupted"
				) {
					return;
				}
				if (intent.type === "replay") {
					await sendQueuedChatReplay({
						beginReplay,
						hasMessageId: (messageId) => localMessageIds.has(messageId),
						origin: "manual",
						queuedMessage,
						resolveConvexToken: getCachedConvexToken,
						sendMessage,
						setLatestRequestBody: (body) => {
							latestRequestBodyRef.current = body;
						},
					});
					return;
				}
				if (queuedMessage.status !== "queued") {
					return;
				}

				const preparedQueuedIntent = await prepareQueuedSteerIntent({
					activeRunId: intent.runId,
					hasMessageId: (messageId) => localMessageIds.has(messageId),
					queuedMessage,
					resolveConvexToken: getCachedConvexToken,
				});
				latestRequestBodyRef.current = preparedQueuedIntent.body;
				rollbackSteerStart = onSteerStart?.();
				await sendMessage(preparedQueuedIntent.message, {
					body: preparedQueuedIntent.body,
				});
			} catch (error) {
				const wasAccepted =
					acceptedQueuedMessageIdsRef.current.has(queuedMessageId);
				if (!wasAccepted) {
					rollbackSteerStart?.();
				}
				logError({
					event: "client.error",
					error,
					message: wasAccepted
						? `Queued ${contextLabel} message was accepted, but its response stream failed`
						: `Failed to send queued ${contextLabel} message now`,
				});
				toast.error(
					wasAccepted
						? "Queued message was accepted, but its response stream disconnected."
						: error instanceof Error
							? error.message
							: "Failed to send queued message now",
				);
			} finally {
				if (sendingQueuedMessageIdRef.current === queuedMessageId) {
					sendingQueuedMessageIdRef.current = null;
					setPendingSendingNowId(null);
				}
			}
		},
		[
			acceptedQueuedMessageIdsRef,
			beginReplay,
			contextLabel,
			isQueueHandoffPending,
			latestRequestBodyRef,
			localMessageIds,
			sendingQueuedMessageIdRef,
			onSteerStart,
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
					: { type: "replay", queuedMessage },
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
					? restoreQueuedMessageAtIndex(messages, editDraft)
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
			const queuedMessage = queuedMessages.find(
				(message) => message._id === queuedMessageId,
			);
			if (!queuedMessage) {
				return;
			}
			if (!workspaceId) {
				toast.error("Workspace is not ready");
				return;
			}

			setDeletingId(queuedMessage._id);
			try {
				await discardQueuedMessage({
					workspaceId,
					chatId,
					queuedMessageId: queuedMessage._id,
				});
				setQueuedMessages((messages) =>
					messages.filter((message) => message._id !== queuedMessage._id),
				);
			} catch (error) {
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
			} finally {
				setDeletingId(null);
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

			setQueuedMessages((messages) => {
				const messagesById = new Map(
					messages.map((message) => [message._id, message]),
				);
				const reorderedMessages = queuedMessageIds
					.map((queuedMessageId) =>
						messagesById.get(queuedMessageId as Id<"assistantQueuedMessages">),
					)
					.filter(
						(message): message is (typeof messages)[number] =>
							message !== undefined,
					);

				return reorderedMessages.length === messages.length
					? reorderedMessages
					: messages;
			});
			void reorderQueuedMessages({
				workspaceId,
				chatId,
				queuedMessageIds: queuedMessageIds as Array<
					Id<"assistantQueuedMessages">
				>,
			}).catch((error) => {
				logError({
					event: "client.error",
					error,
					message: `Failed to reorder queued ${contextLabel} messages`,
				});
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
					isDeleting: deletingId === queuedMessage._id,
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
			deletingId,
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
