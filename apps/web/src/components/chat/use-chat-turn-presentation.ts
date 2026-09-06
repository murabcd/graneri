import type { UIMessage } from "ai";
import * as React from "react";
import { isRenderableAssistantWorkPart } from "@/components/ai-elements/tools/tool-part-like";
import {
	type AssistantActivityUnit,
	getAssistantTurnSequence,
} from "@/lib/assistant-turn-sequence";
import {
	extractFileParts,
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
	isActive: boolean;
	startedAt: number | null;
	turnId: string | null;
};

type ActiveTurnVisualEvent = {
	activityUnits: AssistantActivityUnit[];
	now: number;
	sourceIsLoading: boolean;
	startsNewTurn: boolean;
	turnId: string | null;
};

const groupActivityByMessage = (units: AssistantActivityUnit[]) => {
	const byMessage = new Map<string, AssistantActivityUnit[]>();
	for (const unit of units) {
		const messageUnits = byMessage.get(unit.messageId);
		if (messageUnits) messageUnits.push(unit);
		else byMessage.set(unit.messageId, [unit]);
	}
	return byMessage;
};

const getActivitySnapshotExtent = (units: AssistantActivityUnit[]) => {
	const last = units.at(-1);
	return last
		? last.sourceIndex + (last.kind === "activity" ? last.parts.length : 1)
		: 0;
};

const mergeActivityUnits = (
	previousUnits: AssistantActivityUnit[],
	currentUnits: AssistantActivityUnit[],
) => {
	if (previousUnits.length === 0) return currentUnits;
	if (currentUnits.length === 0 || previousUnits === currentUnits)
		return previousUnits;

	const mergedByMessage = groupActivityByMessage(previousUnits);
	for (const [messageId, units] of groupActivityByMessage(currentUnits)) {
		const previous = mergedByMessage.get(messageId);
		// Activity snapshots grow within a message; hydration can briefly lag the stream.
		if (
			!previous ||
			getActivitySnapshotExtent(units) >= getActivitySnapshotExtent(previous)
		) {
			mergedByMessage.set(messageId, units);
		}
	}
	const mergedUnits = [...mergedByMessage.values()].flat();
	return mergedUnits.length === previousUnits.length &&
		mergedUnits.every((unit, index) => unit === previousUnits[index])
		? previousUnits
		: mergedUnits;
};

const getAssistantTurnActivitySnapshot = (messages: UIMessage[]) => {
	const activityUnits: AssistantActivityUnit[] = [];
	const assistantMessages: UIMessage[] = [];

	for (const message of messages) {
		if (message.role !== "assistant") {
			continue;
		}

		assistantMessages.push(message);
		const sequence = getAssistantTurnSequence(message);
		activityUnits.push(...sequence.activityUnits);
	}

	return {
		activityUnits,
		assistantMessages,
	};
};

const hasRenderableAssistantOutput = (message: UIMessage) =>
	getChatText(message).length > 0 ||
	extractFileParts(message).length > 0 ||
	message.parts.some((part) => isRenderableAssistantWorkPart(part, false));

const EMPTY_ASSISTANT_TURN_ACTIVITY_SNAPSHOT =
	getAssistantTurnActivitySnapshot(EMPTY_TURN);

const advanceActiveTurnVisualState = (
	state: ActiveTurnVisualState,
	event: ActiveTurnVisualEvent,
): ActiveTurnVisualState => {
	const startsActiveTurn =
		event.sourceIsLoading && (!state.isActive || event.startsNewTurn);
	const changesInactiveTurn = !state.isActive && state.turnId !== event.turnId;
	if (startsActiveTurn || changesInactiveTurn) {
		return {
			activityUnits: event.activityUnits,
			isActive: event.sourceIsLoading,
			startedAt: event.sourceIsLoading ? event.now : null,
			turnId: event.turnId,
		};
	}

	const activityUnits = mergeActivityUnits(
		state.activityUnits,
		event.activityUnits,
	);

	if (
		state.turnId === event.turnId &&
		state.activityUnits === activityUnits &&
		state.isActive === event.sourceIsLoading
	)
		return state;
	return {
		...state,
		activityUnits,
		isActive: event.sourceIsLoading,
		turnId: event.turnId ?? state.turnId,
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
	const [activeTurnState, setActiveTurnState] =
		React.useState<ActiveTurnVisualState>({
			activityUnits: [],
			isActive: false,
			startedAt: null,
			turnId: null,
		});
	React.useLayoutEffect(() => {
		setActiveTurnState((state) =>
			advanceActiveTurnVisualState(state, {
				activityUnits: latestAssistantSequence.activityUnits,
				now: Date.now(),
				sourceIsLoading: isLoading,
				startsNewTurn: turnSnapshots
					.slice(0, -1)
					.some(({ messages }) => messages[0]?.id === state.turnId),
				turnId: latestTurnId,
			}),
		);
	}, [isLoading, latestAssistantSequence, latestTurnId, turnSnapshots]);

	const turns = turnSnapshots.map(
		(
			{ activity: currentAssistantSequence, messages: turnMessages },
			turnIndex,
		) => {
			const isLastTurn = turnIndex === turnSnapshots.length - 1;
			const currentAssistantTurnActivityUnits =
				currentAssistantSequence.activityUnits;
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
			const latestAssistantMessage =
				currentAssistantSequence.assistantMessages.at(-1);
			const assistantTurnStartedAt =
				isLastTurn &&
				activeTurnState.startedAt !== null &&
				(activeTurnState.isActive ||
					activeTurnState.turnId === turnMessages[0].id)
					? activeTurnState.startedAt
					: getChatMessageTimestampMs(turnMessages[0]);
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
			const assistantTurnDurationMs = !isAssistantTurnStreaming
				? latestAssistantMetadata?.workDurationMs
				: undefined;

			return {
				assistantTurnActivityUnits,
				assistantTurnDurationMs,
				assistantTurnIsInterrupted: isAssistantTurnInterrupted,
				assistantTurnStartedAt,
				assistantTurnWorkStatus: isAssistantTurnStreaming
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
