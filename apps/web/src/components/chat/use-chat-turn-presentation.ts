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

type ActiveTurnVisualState = {
	activityUnits: AssistantActivityUnit[];
	hasFinalAssistantStarted: boolean;
	isActive: boolean;
	startedAt: number | null;
	turnId: string | null;
};

type ActiveTurnVisualEvent = {
	activityUnits: AssistantActivityUnit[];
	hasAssistantOutput: boolean;
	hasError: boolean;
	hasFinalAssistantStarted: boolean;
	isInterrupted: boolean;
	now: number;
	sourceIsLoading: boolean;
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

const hasRenderableAssistantOutput = (message: UIMessage) =>
	getChatText(message).length > 0 ||
	extractFileParts(message).length > 0 ||
	extractReasoningParts(message).length > 0 ||
	extractToolParts(message).length > 0;

const EMPTY_ASSISTANT_TURN_ACTIVITY_SNAPSHOT =
	getAssistantTurnActivitySnapshot(EMPTY_TURN);

const advanceActiveTurnVisualState = (
	state: ActiveTurnVisualState,
	event: ActiveTurnVisualEvent,
): ActiveTurnVisualState => {
	const activityUnits = mergeActivityUnits(
		state.activityUnits,
		event.activityUnits,
	);
	const hasFinalAssistantStarted =
		state.hasFinalAssistantStarted || event.hasFinalAssistantStarted;

	if (!event.turnId) {
		return !state.isActive
			? state
			: {
					...state,
					activityUnits,
					hasFinalAssistantStarted,
					isActive: false,
					turnId: state.turnId,
				};
	}

	if (!event.sourceIsLoading) {
		if (
			state.isActive &&
			!event.hasAssistantOutput &&
			!event.hasError &&
			!event.isInterrupted &&
			!hasFinalAssistantStarted
		) {
			return state.activityUnits === activityUnits &&
				state.turnId === event.turnId
				? state
				: {
						...state,
						activityUnits,
						turnId: event.turnId,
					};
		}

		return !state.isActive
			? state
			: {
					...state,
					activityUnits,
					hasFinalAssistantStarted,
					isActive: false,
					turnId: event.turnId,
				};
	}

	if (!state.isActive) {
		return {
			activityUnits: event.activityUnits,
			hasFinalAssistantStarted: event.hasFinalAssistantStarted,
			isActive: true,
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
	hasError = false,
	isLoading = false,
	messages,
	scrollAnchorUserMessages,
	streamingMessageIds,
}: {
	hasError?: boolean;
	isLoading?: boolean;
	messages: UIMessage[];
	scrollAnchorUserMessages: boolean;
	streamingMessageIds?: ReadonlySet<string>;
}) => {
	const normalizedMessages = React.useMemo(
		() => normalizeChatMessages(messages),
		[messages],
	);
	const lastMessage = normalizedMessages[normalizedMessages.length - 1];
	const forcedStreamingMessageIds = streamingMessageIds ?? EMPTY_MESSAGE_IDS;
	const groupedTurns = React.useMemo(
		() => groupMessagesIntoTurns(normalizedMessages),
		[normalizedMessages],
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
	const latestTurnIsInterrupted =
		latestAssistantSequence.assistantMessages.some((message) => {
			const metadata = getChatMessageMetadata(message);
			return (
				metadata?.interrupted === true ||
				forcedStreamingMessageIds.has(message.id)
			);
		});
	const latestTurnHasAssistantOutput =
		latestAssistantSequence.assistantMessages.some(
			hasRenderableAssistantOutput,
		);
	const [activeTurnState, setActiveTurnState] =
		React.useState<ActiveTurnVisualState>({
			activityUnits: [],
			hasFinalAssistantStarted: false,
			isActive: false,
			startedAt: null,
			turnId: null,
		});
	React.useLayoutEffect(() => {
		setActiveTurnState((state) =>
			advanceActiveTurnVisualState(state, {
				activityUnits: latestAssistantSequence.activityUnits,
				hasAssistantOutput: latestTurnHasAssistantOutput,
				hasError,
				hasFinalAssistantStarted:
					latestAssistantSequence.hasFinalAssistantStarted,
				isInterrupted: latestTurnIsInterrupted,
				now: Date.now(),
				sourceIsLoading: isLoading,
				turnId: latestTurnId,
			}),
		);
	}, [
		hasError,
		isLoading,
		latestAssistantSequence,
		latestTurnHasAssistantOutput,
		latestTurnId,
		latestTurnIsInterrupted,
	]);

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
					(activeTurnState.isActive ||
						activeTurnState.turnId === turnMessages[0].id),
			);
			const assistantTurnActivityUnits = useAccumulatedActivity
				? mergeActivityUnits(
						activeTurnState.activityUnits,
						currentAssistantTurnActivityUnits,
					)
				: currentAssistantTurnActivityUnits;
			const hasFinalAssistantStarted =
				currentHasFinalAssistantStarted ||
				(useAccumulatedActivity && activeTurnState.hasFinalAssistantStarted);
			const latestAssistantMessage =
				currentAssistantSequence.assistantMessages.at(-1);
			const assistantTurnStartedAt =
				isLastTurn &&
				activeTurnState.startedAt !== null &&
				(activeTurnState.isActive ||
					activeTurnState.turnId === turnMessages[0].id)
					? activeTurnState.startedAt
					: getChatMessageTimestampMs(turnMessages[0]);
			const assistantTurnCompletedAt = latestAssistantMessage
				? getChatMessageTimestampMs(latestAssistantMessage)
				: null;
			const latestAssistantMetadata = latestAssistantMessage
				? getChatMessageMetadata(latestAssistantMessage)
				: null;
			const firstAssistantMessage =
				currentAssistantSequence.assistantMessages[0];
			const firstAssistantMetadata = firstAssistantMessage
				? getChatMessageMetadata(firstAssistantMessage)
				: null;
			const isAssistantTurnInterrupted = Boolean(
				firstAssistantMessage &&
					(firstAssistantMetadata?.interrupted === true ||
						forcedStreamingMessageIds.has(firstAssistantMessage.id)),
			);
			const isAssistantTurnStreaming = Boolean(
				isLastTurn &&
					(isLoading || activeTurnState.isActive) &&
					(!latestAssistantMessage ||
						(latestAssistantMessage.id === lastMessage?.id &&
							latestAssistantMetadata?.interrupted !== true &&
							!forcedStreamingMessageIds.has(latestAssistantMessage.id))),
			);
			const assistantTurnDurationMs =
				!isAssistantTurnStreaming &&
				!(isLastTurn && activeTurnState.startedAt !== null) &&
				assistantTurnStartedAt !== null &&
				assistantTurnCompletedAt !== null
					? Math.max(1, assistantTurnCompletedAt - assistantTurnStartedAt)
					: undefined;

			return {
				assistantTurnActivityUnits,
				assistantTurnDurationMs,
				assistantTurnIsInterrupted: isAssistantTurnInterrupted,
				assistantTurnStartedAt,
				assistantTurnWorkStatus:
					isAssistantTurnStreaming && !hasFinalAssistantStarted
						? ("streaming" as const)
						: ("ready" as const),
				isLastTurn,
				messages: turnMessages,
				scrollAnchor:
					scrollAnchorUserMessages && turnMessages[0].role === "user",
				showAssistantWorkGroup:
					currentAssistantSequence.assistantMessages.length > 0 ||
					(isLastTurn && (isLoading || activeTurnState.isActive)),
			};
		},
	);
	const showAssistantBreathingSpace =
		isLoading ||
		(lastMessage?.role === "assistant" &&
			getLastAssistantHasRenderableContent(
				normalizedMessages,
				hasRenderableAssistantOutput,
			));

	return {
		forcedStreamingMessageIds,
		lastMessageId: lastMessage?.id,
		showAssistantBreathingSpace,
		turns,
	};
};
