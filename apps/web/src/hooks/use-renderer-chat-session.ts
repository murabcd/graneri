import { useChat } from "@ai-sdk/react";
import type { ChatAddToolOutputFunction, UIMessage } from "ai";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import type { FunctionReturnType } from "convex/server";
import * as React from "react";
import {
	appendLocalOptimisticChatMessages,
	normalizeChatMessages,
} from "@/lib/chat-message-state";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import { getUIMessageSeedKey } from "@/lib/chat-snapshot";
import { CHAT_STREAM_UI_THROTTLE_MS } from "@/lib/chat-streaming-performance";
import { removeChatMessageById } from "@/lib/chat-submit-session";
import { createDesktopLocalToolCallHandler } from "@/lib/desktop-local-tool-call";
import {
	mergeRendererChatSessionMessages,
	resolveRendererChatRunState,
} from "@/lib/renderer-chat-session";
import type { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useQueuedChatDrain } from "./use-queued-chat-drain";
import { useQueuedFollowUpControls } from "./use-queued-follow-up-controls";
import { useResumeActiveChatRun } from "./use-resume-active-chat-run";
import { useWorkspaceChatTransport } from "./use-workspace-chat-transport";

type AttachableRun =
	| FunctionReturnType<typeof api.assistantRuns.getAttachableRun>
	| undefined;

export type ScopedLocalOptimisticMessages = {
	chatId: string;
	messages: UIMessage[];
};

const EMPTY_STREAMING_MESSAGE_IDS = new Set<string>();

export const useRendererChatSession = ({
	activeRun,
	chatId,
	contextLabel,
	isExternallyBlocked = false,
	isPreparingRequest,
	localOptimisticMessages,
	onEditQueuedMessage,
	persistedMessages,
	resumeEnabled = true,
	workspaceId,
}: {
	activeRun: AttachableRun;
	chatId: string;
	contextLabel: string;
	isExternallyBlocked?: boolean;
	isPreparingRequest: boolean;
	localOptimisticMessages: ScopedLocalOptimisticMessages | null;
	onEditQueuedMessage: (message: QueuedFollowUpMessage) => void;
	persistedMessages: UIMessage[];
	resumeEnabled?: boolean;
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
	} = useChat({
		id: chatId,
		experimental_throttle: CHAT_STREAM_UI_THROTTLE_MS,
		messages: persistedMessages,
		transport,
		onToolCall: handleToolCall,
		sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
	});
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

	return {
		activeAssistantMessageId,
		controllerMessages,
		displayActiveRun,
		displayMessages,
		error,
		hasLocallyCompletedAssistantMessage,
		isAiRequestPending,
		isChatRequestPending,
		latestRequestBodyRef,
		queuedMessages,
		...queuedFollowUpControls,
		regenerate,
		sendMessage,
		setMessages,
		setQueuedMessages,
		status,
		stop,
		streamingMessageIds,
	};
};
