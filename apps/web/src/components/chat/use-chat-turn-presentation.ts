import type { UIMessage } from "ai";
import * as React from "react";
import {
	type AssistantActivityUnit,
	getAssistantTurnSequence,
} from "@/lib/assistant-turn-sequence";
import {
	extractFileParts,
	extractReasoningParts,
	extractToolParts,
	getChatMessageMetadata,
	getChatText,
} from "@/lib/chat-message";
import { normalizeChatMessages } from "@/lib/chat-message-state";
import { getChatMessageTimestampMs } from "@/lib/chat-timestamp";
import {
	getLastAssistantHasRenderableContent,
	groupMessagesIntoTurns,
} from "@/lib/chat-turns";

const EMPTY_MESSAGE_IDS = new Set<string>();
const EMPTY_TURN: UIMessage[] = [];

type ActiveTurnTemporalState = {
	activityUnits: AssistantActivityUnit[];
	hasFinalAssistantStarted: boolean;
	isLoading: boolean;
	startedAt: number | null;
	turnId: string | null;
};

type ActiveTurnTemporalEvent = {
	activityUnits: AssistantActivityUnit[];
	hasFinalAssistantStarted: boolean;
	isLoading: boolean;
	now: number;
	turnId: string | null;
};

const getActivityUnitIdentity = (unit: AssistantActivityUnit) =>
	`${unit.messageId}:${unit.kind}:${unit.sourceIndex}`;

const mergeActivityUnits = (
	previousUnits: AssistantActivityUnit[],
	currentUnits: AssistantActivityUnit[],
) => {
	if (previousUnits.length === 0) {
		return currentUnits;
	}
	if (currentUnits.length === 0 || previousUnits === currentUnits) {
		return previousUnits;
	}

	const currentByIdentity = new Map(
		currentUnits.map((unit) => [getActivityUnitIdentity(unit), unit]),
	);
	const previousIdentities = new Set(
		previousUnits.map(getActivityUnitIdentity),
	);
	let changed = false;
	const mergedUnits = previousUnits.map((previousUnit) => {
		const currentUnit = currentByIdentity.get(
			getActivityUnitIdentity(previousUnit),
		);
		if (!currentUnit || currentUnit === previousUnit) {
			return previousUnit;
		}

		changed = true;
		return currentUnit;
	});

	for (const currentUnit of currentUnits) {
		if (previousIdentities.has(getActivityUnitIdentity(currentUnit))) {
			continue;
		}
		changed = true;
		mergedUnits.push(currentUnit);
	}

	return changed ? mergedUnits : previousUnits;
};

const getAssistantTurnActivitySnapshot = (messages: UIMessage[]) => {
	const activityUnits: AssistantActivityUnit[] = [];
	const assistantMessages: UIMessage[] = [];
	let hasFinalAssistantStarted = false;

	for (const message of messages) {
		if (message.role !== "assistant") {
			continue;
		}

		assistantMessages.push(message);
		const sequence = getAssistantTurnSequence(message);
		activityUnits.push(...sequence.activityUnits);
		hasFinalAssistantStarted ||= sequence.hasFinalAnswerStarted;
	}

	return {
		activityUnits,
		assistantMessages,
		hasFinalAssistantStarted,
	};
};

const EMPTY_ASSISTANT_TURN_ACTIVITY_SNAPSHOT =
	getAssistantTurnActivitySnapshot(EMPTY_TURN);

const advanceActiveTurnTemporalState = (
	state: ActiveTurnTemporalState,
	event: ActiveTurnTemporalEvent,
): ActiveTurnTemporalState => {
	const activityUnits = mergeActivityUnits(
		state.activityUnits,
		event.activityUnits,
	);
	const hasFinalAssistantStarted =
		state.hasFinalAssistantStarted || event.hasFinalAssistantStarted;

	if (!event.isLoading || !event.turnId) {
		return !state.isLoading
			? state
			: {
					...state,
					activityUnits,
					hasFinalAssistantStarted,
					isLoading: false,
					turnId: event.turnId ?? state.turnId,
				};
	}

	if (!state.isLoading) {
		return {
			activityUnits: event.activityUnits,
			hasFinalAssistantStarted: event.hasFinalAssistantStarted,
			isLoading: true,
			startedAt: event.now,
			turnId: event.turnId,
		};
	}

	if (
		state.turnId === event.turnId &&
		state.activityUnits === activityUnits &&
		state.hasFinalAssistantStarted === hasFinalAssistantStarted
	) {
		return state;
	}

	return {
		...state,
		activityUnits,
		hasFinalAssistantStarted,
		turnId: event.turnId,
	};
};

export const useChatTurnPresentation = ({
	isLoading = false,
	messages,
	scrollAnchorUserMessages,
	streamingMessageIds,
}: {
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
	const turnSnapshots = React.useMemo(
		() =>
			groupedTurns.map((turnMessages) => ({
				activity: getAssistantTurnActivitySnapshot(turnMessages),
				messages: turnMessages,
			})),
		[groupedTurns],
	);
	const latestTurnSnapshot = turnSnapshots.at(-1);
	const latestTurn = latestTurnSnapshot?.messages ?? EMPTY_TURN;
	const latestTurnId = latestTurn[0]?.id ?? null;
	const latestAssistantSequence =
		latestTurnSnapshot?.activity ?? EMPTY_ASSISTANT_TURN_ACTIVITY_SNAPSHOT;
	const [temporalState, setTemporalState] =
		React.useState<ActiveTurnTemporalState>({
			activityUnits: [],
			hasFinalAssistantStarted: false,
			isLoading: false,
			startedAt: null,
			turnId: null,
		});
	React.useLayoutEffect(() => {
		setTemporalState((state) =>
			advanceActiveTurnTemporalState(state, {
				activityUnits: latestAssistantSequence.activityUnits,
				hasFinalAssistantStarted:
					latestAssistantSequence.hasFinalAssistantStarted,
				isLoading,
				now: Date.now(),
				turnId: latestTurnId,
			}),
		);
	}, [isLoading, latestAssistantSequence, latestTurnId]);

	const turns = turnSnapshots.map(
		(
			{ activity: currentAssistantSequence, messages: turnMessages },
			turnIndex,
		) => {
			const isLastTurn = turnIndex === turnSnapshots.length - 1;
			const currentAssistantTurnActivityUnits =
				currentAssistantSequence.activityUnits;
			const currentHasFinalAssistantStarted =
				currentAssistantSequence.hasFinalAssistantStarted;
			const useAccumulatedActivity = Boolean(
				isLastTurn &&
					(temporalState.isLoading ||
						temporalState.turnId === turnMessages[0].id),
			);
			const assistantTurnActivityUnits = useAccumulatedActivity
				? mergeActivityUnits(
						temporalState.activityUnits,
						currentAssistantTurnActivityUnits,
					)
				: currentAssistantTurnActivityUnits;
			const hasFinalAssistantStarted =
				currentHasFinalAssistantStarted ||
				(useAccumulatedActivity && temporalState.hasFinalAssistantStarted);
			const latestAssistantMessage =
				currentAssistantSequence.assistantMessages.at(-1);
			const assistantTurnStartedAt =
				isLastTurn &&
				temporalState.startedAt !== null &&
				(temporalState.isLoading || temporalState.turnId === turnMessages[0].id)
					? temporalState.startedAt
					: getChatMessageTimestampMs(turnMessages[0]);
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
			const assistantTurnDurationMs =
				!isAssistantTurnStreaming &&
				!(isLastTurn && temporalState.startedAt !== null) &&
				assistantTurnStartedAt !== null &&
				assistantTurnCompletedAt !== null
					? Math.max(1, assistantTurnCompletedAt - assistantTurnStartedAt)
					: undefined;

			return {
				assistantTurnActivityUnits,
				assistantTurnDurationMs,
				assistantTurnStartedAt,
				assistantTurnWorkStatus:
					isAssistantTurnStreaming && !hasFinalAssistantStarted
						? ("streaming" as const)
						: ("ready" as const),
				firstAssistantMessageId:
					currentAssistantSequence.assistantMessages[0]?.id,
				isLastTurn,
				messages: turnMessages,
				scrollAnchor:
					scrollAnchorUserMessages && turnMessages[0].role === "user",
				showAssistantWorkGroup:
					currentAssistantSequence.assistantMessages.length > 0,
			};
		},
	);
	const showAssistantBreathingSpace =
		isLoading ||
		(lastMessage?.role === "assistant" &&
			getLastAssistantHasRenderableContent(
				displayMessages,
				(message) =>
					getChatText(message).length > 0 ||
					extractFileParts(message).length > 0 ||
					extractReasoningParts(message).length > 0 ||
					extractToolParts(message).length > 0,
			));

	return {
		forcedStreamingMessageIds,
		lastMessageId: lastMessage?.id,
		showAssistantBreathingSpace,
		turns,
	};
};
