import { getMatchingPendingHostedHumanDecision } from "@workspace/ai/hosted-human-decision";
import type { UIMessage } from "ai";
import { useQuery } from "convex/react";
import * as React from "react";
import type { AttachableAssistantRun } from "@/lib/attachable-assistant-run";
import { appendLocalOptimisticChatMessages } from "@/lib/chat-message-state";
import {
	mergeRendererChatSessionMessages,
	resolveRendererChatRunState,
} from "@/lib/renderer-chat-session";
import { api } from "../../../../convex/_generated/api";
import type { ScopedLocalOptimisticMessages } from "./use-chat-interaction-session";

const EMPTY_STREAMING_MESSAGE_IDS = new Set<string>();

export const useRendererChatPresentation = ({
	activeRun,
	chatId,
	controllerMessages,
	isAiRequestPending,
	isChatRequestPending,
	localOptimisticMessages,
	persistedMessages,
	steerHandoffStreamingMessageIds,
}: {
	activeRun: AttachableAssistantRun | null;
	chatId: string;
	controllerMessages: UIMessage[];
	isAiRequestPending: boolean;
	isChatRequestPending: boolean;
	localOptimisticMessages: ScopedLocalOptimisticMessages | null;
	persistedMessages: UIMessage[];
	steerHandoffStreamingMessageIds: ReadonlySet<string>;
}) => {
	const runPlan = useQuery(
		api.assistantRunActivity.getActivePlan,
		activeRun ? { runId: activeRun._id } : "skip",
	);
	const runState = React.useMemo(
		() =>
			resolveRendererChatRunState({
				activeRun,
				controllerMessages,
				isAiRequestPending,
				persistedMessages,
			}),
		[activeRun, controllerMessages, isAiRequestPending, persistedMessages],
	);
	const activeSteerMessageIds =
		runState.displayActiveRun || isChatRequestPending
			? steerHandoffStreamingMessageIds
			: EMPTY_STREAMING_MESSAGE_IDS;
	const mergedMessages = React.useMemo(
		() =>
			mergeRendererChatSessionMessages({
				activeAssistantMessageId: runState.activeAssistantMessageId,
				controllerMessages,
				displayActiveRun: runState.displayActiveRun,
				persistedMessages,
			}),
		[
			controllerMessages,
			persistedMessages,
			runState.activeAssistantMessageId,
			runState.displayActiveRun,
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
				pendingDecision: runState.displayActiveRun?.pendingDecision,
			}),
		[displayMessages, runState.displayActiveRun?.pendingDecision],
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
				...(runState.displayActiveRun?.interruptedAssistantMessageIds ?? []),
			]),
		[
			activeSteerMessageIds,
			runState.displayActiveRun?.interruptedAssistantMessageIds,
		],
	);

	return {
		...runState,
		displayMessages,
		localMessageIds,
		pendingHumanDecision,
		runPlan: runPlan ?? null,
		streamingMessageIds,
	};
};
