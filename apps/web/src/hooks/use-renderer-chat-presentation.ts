import { getMatchingPendingHostedHumanDecision } from "@workspace/ai/hosted-human-decision";
import type { UIMessage } from "ai";
import { useQuery } from "convex/react";
import * as React from "react";
import type { AttachableAssistantRun } from "@/lib/attachable-assistant-run";
import { appendLocalOptimisticChatMessages } from "@/lib/chat-message-state";
import {
	mergeRendererChatSessionMessages,
	resolveActiveAssistantMessageId,
} from "@/lib/renderer-chat-session";
import { api } from "../../../../convex/_generated/api";
import type { ScopedLocalOptimisticMessages } from "./use-chat-interaction-session";

const EMPTY_STREAMING_MESSAGE_IDS = new Set<string>();

export const useRendererChatPresentation = ({
	activeRun,
	chatId,
	controllerMessages,
	isChatRequestPending,
	localOptimisticMessages,
	persistedMessages,
	steerHandoffStreamingMessageIds,
}: {
	activeRun: AttachableAssistantRun | null;
	chatId: string;
	controllerMessages: UIMessage[];
	isChatRequestPending: boolean;
	localOptimisticMessages: ScopedLocalOptimisticMessages | null;
	persistedMessages: UIMessage[];
	steerHandoffStreamingMessageIds: ReadonlySet<string>;
}) => {
	const runPlan = useQuery(
		api.assistantRunActivity.getActivePlan,
		activeRun ? { runId: activeRun._id } : "skip",
	);
	const activeAssistantMessageId = React.useMemo(
		() =>
			resolveActiveAssistantMessageId({
				activeRun,
				controllerMessages,
				persistedMessages,
			}),
		[activeRun, controllerMessages, persistedMessages],
	);
	const activeSteerMessageIds =
		activeRun || isChatRequestPending
			? steerHandoffStreamingMessageIds
			: EMPTY_STREAMING_MESSAGE_IDS;
	const mergedMessages = React.useMemo(
		() =>
			mergeRendererChatSessionMessages({
				activeAssistantMessageId,
				controllerMessages,
				activeRun,
				persistedMessages,
			}),
		[
			controllerMessages,
			persistedMessages,
			activeAssistantMessageId,
			activeRun,
		],
	);
	const displayMessages = React.useMemo(
		() =>
			appendLocalOptimisticChatMessages({
				displayMessages: mergedMessages,
				localOptimisticMessages:
					localOptimisticMessages?.chatId === chatId
						? localOptimisticMessages.messages
						: [],
				resolvedMessages: persistedMessages,
			}),
		[chatId, localOptimisticMessages, mergedMessages, persistedMessages],
	);
	const pendingHumanDecision = React.useMemo(
		() =>
			getMatchingPendingHostedHumanDecision({
				messages: displayMessages,
				pendingDecision: activeRun?.pendingDecision,
			}),
		[displayMessages, activeRun?.pendingDecision],
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
				...activeSteerMessageIds,
				...(activeRun?.interruptedAssistantMessageIds ?? []),
			]),
		[activeSteerMessageIds, activeRun?.interruptedAssistantMessageIds],
	);

	return {
		activeAssistantMessageId,
		displayMessages,
		localMessageIds,
		pendingHumanDecision,
		runPlan: activeRun ? (runPlan ?? null) : null,
		streamingMessageIds,
	};
};
