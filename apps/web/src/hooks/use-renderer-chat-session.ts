import { useChat } from "@ai-sdk/react";
import {
	getPendingToolApproval,
	type ToolApprovalRequest,
} from "@workspace/ai/tool-approval-state";
import type { ChatAddToolOutputFunction, UIMessage } from "ai";
import {
	lastAssistantMessageIsCompleteWithApprovalResponses,
	lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import type { FunctionReturnType } from "convex/server";
import * as React from "react";
import { toast } from "sonner";
import { stopActiveChatStream } from "@/lib/chat-active-stream";
import { stopChatInteraction } from "@/lib/chat-interaction-session";
import {
	appendLocalOptimisticChatMessages,
	normalizeChatMessages,
} from "@/lib/chat-message-state";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import { getUIMessageSeedKey } from "@/lib/chat-snapshot";
import { CHAT_STREAM_UI_THROTTLE_MS } from "@/lib/chat-streaming-performance";
import { removeChatMessageById } from "@/lib/chat-submit-session";
import { createDesktopLocalToolCallHandler } from "@/lib/desktop-local-tool-call";
import { logError } from "@/lib/logger";
import {
	mergeRendererChatSessionMessages,
	resolveRendererChatRunState,
} from "@/lib/renderer-chat-session";
import type { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useChatInteractionSession } from "./use-chat-interaction-session";
import { useQueuedChatDrain } from "./use-queued-chat-drain";
import { useQueuedFollowUpControls } from "./use-queued-follow-up-controls";
import { useResumeActiveChatRun } from "./use-resume-active-chat-run";
import { useWorkspaceChatTransport } from "./use-workspace-chat-transport";

type AttachableRun =
	| FunctionReturnType<typeof api.assistantRuns.getAttachableRun>
	| undefined;

const EMPTY_STREAMING_MESSAGE_IDS = new Set<string>();

const shouldAutomaticallyContinueChat = (args: { messages: UIMessage[] }) =>
	lastAssistantMessageIsCompleteWithApprovalResponses(args) ||
	lastAssistantMessageIsCompleteWithToolCalls(args);

export const useRendererChatSession = ({
	activeRun,
	chatId,
	contextLabel,
	isExternallyBlocked = false,
	onEditQueuedMessage,
	persistedMessages,
	resumeEnabled = true,
	stopExternalRun,
	workspaceId,
}: {
	activeRun: AttachableRun;
	chatId: string;
	contextLabel: string;
	isExternallyBlocked?: boolean;
	onEditQueuedMessage: (message: QueuedFollowUpMessage) => void;
	persistedMessages: UIMessage[];
	resumeEnabled?: boolean;
	stopExternalRun?: () => Promise<boolean>;
	workspaceId: Id<"workspaces"> | null;
}) => {
	const attachableActiveRun =
		activeRun && activeRun.status !== "stopping" ? activeRun : null;
	const transport = useWorkspaceChatTransport(workspaceId);
	const latestRequestBodyRef = React.useRef<Record<string, unknown> | null>(
		null,
	);
	const addToolOutputRef =
		React.useRef<ChatAddToolOutputFunction<UIMessage> | null>(null);
	const [activeSteerHandoffStreamingMessageIds, setActiveSteerHandoffIds] =
		React.useState<ReadonlySet<string>>(() => new Set());
	const handleToolCall = React.useMemo(
		() =>
			createDesktopLocalToolCallHandler({
				addToolOutputRef,
				latestRequestBodyRef,
			}),
		[],
	);
	const {
		messages,
		setMessages,
		sendMessage,
		regenerate,
		error,
		status,
		stop,
		resumeStream,
		addToolOutput,
		addToolApprovalResponse,
	} = useChat({
		id: chatId,
		experimental_throttle: CHAT_STREAM_UI_THROTTLE_MS,
		messages: persistedMessages,
		transport,
		onToolCall: handleToolCall,
		sendAutomaticallyWhen: shouldAutomaticallyContinueChat,
	});
	const {
		beginRequestPreparation,
		commitOptimisticMessage,
		isPreparingRequest,
		localOptimisticMessages,
		rollbackOptimisticMessage,
		truncateMessagesFrom,
	} = useChatInteractionSession({ chatId, setMessages });
	React.useEffect(() => {
		addToolOutputRef.current = addToolOutput;

		return () => {
			if (addToolOutputRef.current === addToolOutput) {
				addToolOutputRef.current = null;
			}
		};
	}, [addToolOutput]);

	const controllerMessages = React.useMemo(
		() => normalizeChatMessages(messages),
		[messages],
	);
	const isAiRequestPending = status === "submitted" || status === "streaming";
	const isChatRequestPending = isAiRequestPending || isPreparingRequest;
	const {
		activeAssistantMessageId,
		displayActiveRun,
		hasLocallyCompletedAssistantMessage,
	} = React.useMemo(
		() =>
			resolveRendererChatRunState({
				activeRun: attachableActiveRun,
				controllerMessages,
				isAiRequestPending,
				persistedMessages,
			}),
		[
			attachableActiveRun,
			controllerMessages,
			isAiRequestPending,
			persistedMessages,
		],
	);
	const steerHandoffStreamingMessageIds =
		displayActiveRun || isChatRequestPending
			? activeSteerHandoffStreamingMessageIds
			: EMPTY_STREAMING_MESSAGE_IDS;
	useResumeActiveChatRun({
		activeRun: displayActiveRun,
		chatId,
		enabled: resumeEnabled && !isChatRequestPending,
		resumeStream,
		workspaceId,
	});

	const persistedMessagesSeedKey = React.useMemo(
		() => getUIMessageSeedKey(persistedMessages),
		[persistedMessages],
	);
	const appliedPersistedMessagesSeedKeyRef = React.useRef(
		persistedMessagesSeedKey,
	);
	const previousChatIdRef = React.useRef(chatId);

	React.useEffect(() => {
		if (previousChatIdRef.current !== chatId) {
			previousChatIdRef.current = chatId;
			appliedPersistedMessagesSeedKeyRef.current = persistedMessagesSeedKey;
			setMessages(persistedMessages);
			return;
		}

		if (isChatRequestPending) {
			return;
		}

		setMessages((currentMessages) => {
			const currentMessagesSeedKey = getUIMessageSeedKey(currentMessages);
			const nextPersistedMessages = activeAssistantMessageId
				? removeChatMessageById(persistedMessages, activeAssistantMessageId)
				: persistedMessages;
			const shouldUsePersistedMessages =
				currentMessages.length === 0 ||
				currentMessagesSeedKey === appliedPersistedMessagesSeedKeyRef.current ||
				(!activeRun && nextPersistedMessages.length > 0);

			if (shouldUsePersistedMessages) {
				appliedPersistedMessagesSeedKeyRef.current = persistedMessagesSeedKey;
				return nextPersistedMessages;
			}

			return normalizeChatMessages(currentMessages);
		});
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [
		activeRun,
		activeAssistantMessageId,
		chatId,
		isChatRequestPending,
		persistedMessages,
		persistedMessagesSeedKey,
		setMessages,
	]);

	const mergedDisplayMessages = React.useMemo(
		() =>
			mergeRendererChatSessionMessages({
				activeAssistantMessageId,
				controllerMessages,
				displayActiveRun,
				persistedMessages,
			}),
		[
			activeAssistantMessageId,
			controllerMessages,
			displayActiveRun,
			persistedMessages,
		],
	);
	const displayMessages = React.useMemo(
		() =>
			appendLocalOptimisticChatMessages({
				displayMessages: mergedDisplayMessages,
				localOptimisticMessages:
					localOptimisticMessages?.chatId === chatId
						? localOptimisticMessages.messages
						: [],
				resolvedMessages: persistedMessages,
			}),
		[chatId, localOptimisticMessages, mergedDisplayMessages, persistedMessages],
	);
	const pendingToolApproval = React.useMemo(
		() => getPendingToolApproval(displayMessages),
		[displayMessages],
	);
	const respondToToolApproval = React.useCallback(
		async ({
			approval,
			approved,
			requestBody,
		}: {
			approval: ToolApprovalRequest;
			approved: boolean;
			requestBody: Record<string, unknown>;
		}) => {
			if (!displayActiveRun) {
				throw new Error("Tool approval requires an active assistant run.");
			}

			latestRequestBodyRef.current = requestBody;
			await addToolApprovalResponse({
				id: approval.approvalId,
				approved,
				reason: approved ? "Approved by user." : "Denied by user.",
				options: {
					body: {
						...requestBody,
						continueRunId: displayActiveRun._id,
					},
				},
			});
		},
		[addToolApprovalResponse, displayActiveRun],
	);
	const localMessageIds = React.useMemo(
		() =>
			new Set([
				...controllerMessages.map((message) => message.id),
				...(localOptimisticMessages?.chatId === chatId
					? localOptimisticMessages.messages.map((message) => message.id)
					: []),
			]),
		[chatId, controllerMessages, localOptimisticMessages],
	);
	const streamingMessageIds = React.useMemo(
		() =>
			new Set([
				...steerHandoffStreamingMessageIds,
				...(displayActiveRun?.interruptedAssistantMessageIds ?? []),
			]),
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
		[
			displayActiveRun?.interruptedAssistantMessageIds,
			steerHandoffStreamingMessageIds,
		],
	);

	const { queuedMessages, setQueuedMessages } = useQueuedChatDrain({
		activeRun: displayActiveRun,
		chatId,
		contextLabel,
		isBlocked: isChatRequestPending || isExternallyBlocked,
		latestRequestBodyRef,
		localMessageIds,
		sendMessage,
		workspaceId,
	});
	const queuedFollowUpControls = useQueuedFollowUpControls({
		activeRun: displayActiveRun,
		chatId,
		contextLabel,
		latestRequestBodyRef,
		localMessageIds,
		onEditMessage: onEditQueuedMessage,
		onSteerStart: () => {
			const handoffMessageIds = [
				...(activeAssistantMessageId ? [activeAssistantMessageId] : []),
				...(displayActiveRun?.assistantMessageId
					? [displayActiveRun.assistantMessageId]
					: []),
			];
			if (handoffMessageIds.length === 0) {
				return undefined;
			}

			setActiveSteerHandoffIds((messageIds) => {
				const nextMessageIds = new Set(messageIds);
				for (const messageId of handoffMessageIds) {
					nextMessageIds.add(messageId);
				}
				return nextMessageIds;
			});

			return () =>
				setActiveSteerHandoffIds((messageIds) => {
					const nextMessageIds = new Set(messageIds);
					for (const messageId of handoffMessageIds) {
						nextMessageIds.delete(messageId);
					}
					return nextMessageIds;
				});
		},
		queuedMessages,
		sendMessage,
		setQueuedMessages,
		workspaceId,
	});
	const isPersistedChatStreaming = Boolean(displayActiveRun);
	const isChatUiPending =
		isChatRequestPending || isPersistedChatStreaming || isExternallyBlocked;
	const stopCurrentStream = React.useCallback(
		async ({ interruptActiveRun = false } = {}) => {
			await stopChatInteraction({
				chatId,
				contextLabel,
				hasDisplayActiveRun: Boolean(displayActiveRun),
				interruptActiveRun,
				stopActiveRun: stopActiveChatStream,
				stopExternalRun,
				stopLocalStream: stop,
				workspaceId,
			});
		},
		[
			chatId,
			contextLabel,
			displayActiveRun,
			stop,
			stopExternalRun,
			workspaceId,
		],
	);
	const handleStop = React.useCallback(() => {
		const stopPromise = queuedMessages[0]
			? queuedFollowUpControls.sendQueuedFollowUpNow()
			: stopCurrentStream();

		void stopPromise.catch((error) => {
			logError({
				event: "client.error",
				error,
				message: `Failed to stop ${contextLabel} stream`,
			});
			toast.error(
				error instanceof Error
					? error.message
					: `Failed to stop ${contextLabel} stream`,
			);
		});
	}, [
		contextLabel,
		queuedFollowUpControls.sendQueuedFollowUpNow,
		queuedMessages,
		stopCurrentStream,
	]);

	return {
		activeAssistantMessageId,
		beginRequestPreparation,
		commitOptimisticMessage,
		canStop: isChatUiPending,
		controllerMessages,
		displayActiveRun,
		displayMessages,
		error,
		hasLocallyCompletedAssistantMessage,
		handleStop,
		isAiRequestPending,
		isChatRequestPending,
		isChatUiPending,
		isPreparingRequest,
		latestRequestBodyRef,
		pendingToolApproval,
		queuedMessages,
		...queuedFollowUpControls,
		regenerate,
		respondToToolApproval,
		rollbackOptimisticMessage,
		sendMessage,
		setMessages,
		setQueuedMessages,
		status,
		stopCurrentStream,
		streamingMessageIds,
		truncateMessagesFrom,
	};
};
