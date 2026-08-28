import type { UIMessage } from "ai";
import * as React from "react";
import { isAssistantWorkPart } from "@/components/ai-elements/tools/tool-part-like";
import {
	extractFileParts,
	extractReasoningParts,
	extractToolParts,
	getChatMessageMetadata,
	getChatText,
} from "@/lib/chat-message";
import { normalizeChatMessages } from "@/lib/chat-message-state";
import { collectMessageSources } from "@/lib/chat-sources";
import { getChatMessageTimestampMs } from "@/lib/chat-timestamp";
import {
	getLastAssistantHasRenderableContent,
	groupMessagesIntoTurns,
} from "@/lib/chat-turns";

const EMPTY_MESSAGE_IDS = new Set<string>();

type ActiveTurnTemporalState = {
	hasStartedWork: boolean;
	isLoading: boolean;
	startedAt: number | null;
	turnId: string | null;
};

type ActiveTurnTemporalEvent = {
	hasAssistantWork: boolean;
	isLoading: boolean;
	now: number;
	turnId: string | null;
};

const advanceActiveTurnTemporalState = (
	state: ActiveTurnTemporalState,
	event: ActiveTurnTemporalEvent,
): ActiveTurnTemporalState => {
	if (!event.isLoading || !event.turnId) {
		return !state.isLoading && !state.hasStartedWork
			? state
			: {
					...state,
					hasStartedWork: false,
					isLoading: false,
					turnId: event.turnId ?? state.turnId,
				};
	}

	if (!state.isLoading) {
		return {
			hasStartedWork: event.hasAssistantWork,
			isLoading: true,
			startedAt: event.now,
			turnId: event.turnId,
		};
	}

	if (
		state.turnId === event.turnId &&
		(state.hasStartedWork || !event.hasAssistantWork)
	) {
		return state;
	}

	return {
		...state,
		hasStartedWork: state.hasStartedWork || event.hasAssistantWork,
		turnId: event.turnId,
	};
};

export const useChatTurnPresentation = ({
	includeSources,
	isLoading = false,
	messages,
	scrollAnchorUserMessages,
	streamingMessageIds,
}: {
	includeSources: boolean;
	isLoading?: boolean;
	messages: UIMessage[];
	scrollAnchorUserMessages: boolean;
	streamingMessageIds?: ReadonlySet<string>;
}) => {
	const normalizedMessages = React.useMemo(
		() => normalizeChatMessages(messages),
		[messages],
	);
	const displayMessages = React.useMemo(() => {
		const lastMessage = normalizedMessages[normalizedMessages.length - 1];

		if (!isLoading || lastMessage?.role === "assistant") {
			return normalizedMessages;
		}

		return [
			...normalizedMessages,
			{
				id: "pending-assistant-message",
				role: "assistant" as const,
				parts: [],
			},
		];
	}, [isLoading, normalizedMessages]);
	const lastMessage = displayMessages[displayMessages.length - 1];
	const forcedStreamingMessageIds = streamingMessageIds ?? EMPTY_MESSAGE_IDS;
	const groupedTurns = React.useMemo(
		() => groupMessagesIntoTurns(displayMessages),
		[displayMessages],
	);
	const latestTurn = groupedTurns.at(-1) ?? [];
	const latestTurnId = latestTurn[0]?.id ?? null;
	const latestTurnHasAssistantWork = latestTurn.some(
		(message) =>
			message.role === "assistant" && message.parts.some(isAssistantWorkPart),
	);
	const [temporalState, setTemporalState] =
		React.useState<ActiveTurnTemporalState>({
			hasStartedWork: false,
			isLoading: false,
			startedAt: null,
			turnId: null,
		});
	React.useLayoutEffect(() => {
		setTemporalState((state) =>
			advanceActiveTurnTemporalState(state, {
				hasAssistantWork: latestTurnHasAssistantWork,
				isLoading,
				now: Date.now(),
				turnId: latestTurnId,
			}),
		);
	}, [isLoading, latestTurnHasAssistantWork, latestTurnId]);

	const turns = groupedTurns.map((turnMessages, turnIndex) => {
		const isLastTurn = turnIndex === groupedTurns.length - 1;
		const assistantMessages = turnMessages.filter(
			(message) => message.role === "assistant",
		);
		const assistantWorkParts = assistantMessages.flatMap(
			(message) => message.parts,
		);
		const hasCurrentAssistantWork =
			assistantWorkParts.some(isAssistantWorkPart);
		const latestAssistantMessage = assistantMessages.at(-1);
		const assistantTurnStartedAt =
			getChatMessageTimestampMs(turnMessages[0]) ??
			(temporalState.turnId === turnMessages[0].id
				? temporalState.startedAt
				: null);
		const assistantTurnCompletedAt = latestAssistantMessage
			? getChatMessageTimestampMs(latestAssistantMessage)
			: null;
		const latestAssistantMetadata = latestAssistantMessage
			? getChatMessageMetadata(latestAssistantMessage)
			: null;
		const isAssistantTurnStreaming = Boolean(
			isLastTurn &&
				isLoading &&
				latestAssistantMessage?.id === lastMessage?.id &&
				latestAssistantMetadata?.interrupted !== true &&
				!forcedStreamingMessageIds.has(latestAssistantMessage.id),
		);
		const hasAssistantWorkInTurn =
			hasCurrentAssistantWork ||
			(isAssistantTurnStreaming &&
				temporalState.turnId === turnMessages[0].id &&
				temporalState.hasStartedWork);
		const assistantTurnDurationMs =
			!isAssistantTurnStreaming &&
			assistantTurnStartedAt !== null &&
			assistantTurnCompletedAt !== null
				? Math.max(1, assistantTurnCompletedAt - assistantTurnStartedAt)
				: undefined;

		return {
			assistantTurnDurationMs,
			assistantTurnStartedAt,
			assistantTurnWorkParts: assistantWorkParts,
			assistantTurnWorkStatus: isAssistantTurnStreaming
				? ("streaming" as const)
				: ("ready" as const),
			firstAssistantMessageId: assistantMessages[0]?.id,
			hasAssistantWorkInTurn,
			isLastTurn,
			messages: turnMessages,
			scrollAnchor: scrollAnchorUserMessages && turnMessages[0].role === "user",
			showAssistantWorkSummary:
				hasAssistantWorkInTurn || !isAssistantTurnStreaming,
		};
	});
	const showAssistantBreathingSpace =
		isLoading ||
		(lastMessage?.role === "assistant" &&
			getLastAssistantHasRenderableContent(
				displayMessages,
				(message) =>
					getChatText(message).length > 0 ||
					extractFileParts(message).length > 0 ||
					extractReasoningParts(message).length > 0 ||
					extractToolParts(message).length > 0 ||
					(includeSources && collectMessageSources(message).length > 0),
			));

	return {
		forcedStreamingMessageIds,
		lastMessageId: lastMessage?.id,
		showAssistantBreathingSpace,
		turns,
	};
};
