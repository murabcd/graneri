import type { NoteReference } from "@workspace/ai/note-tools";
import { Bubble, BubbleContent } from "@workspace/ui/components/bubble";
import {
	Marker,
	MarkerContent,
	MarkerIcon,
} from "@workspace/ui/components/marker";
import { Message, MessageContent } from "@workspace/ui/components/message";
import {
	MessageScrollerContent,
	MessageScrollerItem,
	useMessageScrollerScrollable,
} from "@workspace/ui/components/message-scroller";
import type { UIMessage } from "ai";
import { cn } from "cn";
import {
	CornerDownRight,
	GitBranch,
	LoaderCircle,
	Scissors,
} from "lucide-react";
import * as React from "react";
import { FileAttachmentCards } from "@/components/ai-elements/file-attachment-cards";
import { ShimmerText } from "@/components/ai-elements/shimmer";
import {
	AssistantActivityGroup,
	AssistantWorkGroup,
} from "@/components/ai-elements/tools/tool-group";
import { isRenderableAssistantWorkPart } from "@/components/ai-elements/tools/tool-part-like";
import { AppSourceIcon } from "@/components/app-source-icon";
import { ChatChartArtifacts } from "@/components/chat/chat-chart-artifacts";
import {
	ChatNoteCard,
	ChatNoteReference,
} from "@/components/chat/chat-note-reference";
import { CollapsibleMessageContent } from "@/components/chat/collapsible-message-content";
import {
	ASSISTANT_CHAT_CONTENT_CLASS,
	CHAT_MESSAGE_MAX_WIDTH_CLASS,
	USER_CHAT_BUBBLE_CLASS,
} from "@/components/chat/message-layout";
import { ChatRecipeReceipt } from "@/components/chat/recipe-receipt";
import { useChatTurnPresentation } from "@/components/chat/use-chat-turn-presentation";
import {
	type AssistantActivityUnit,
	getAssistantFinalText,
} from "@/lib/assistant-turn-sequence";
import { extractChatChartArtifacts } from "@/lib/chat-chart-artifact";
import type { ChatMessageMention } from "@/lib/chat-composer-mentions";
import {
	extractMessageFileParts,
	getChatMessageMetadata,
	getChatText,
} from "@/lib/chat-message";
import { extractReadNoteReferences } from "@/lib/chat-note-references";
import {
	formatChatMessageTimestamp,
	getChatMessageTimestamp,
} from "@/lib/chat-timestamp";

export type ChatMessageActionContext = {
	isStreamingAssistantMessage: boolean;
	message: UIMessage;
	text: string;
	timestamp: string | null;
};

export type ChatHistoryMarkerState =
	| { kind: "original" }
	| {
			kind: "fork";
			historyOmittedBefore: boolean;
	  };

export type ChatCompactionActivity = {
	anchorMessageId: string;
	status: "running" | "completed";
};

const EMPTY_CHART_ARTIFACTS: ReturnType<typeof extractChatChartArtifacts> = [];
const EMPTY_ASSISTANT_ACTIVITY_UNITS: AssistantActivityUnit[] = [];
const CHAT_HISTORY_LOADER_ID = "chat-history-loader";

function ChatHistoryLoader({
	isLoading,
	onLoad,
}: {
	isLoading: boolean;
	onLoad: () => void;
}) {
	const { start: canScrollToEarlierMessages } = useMessageScrollerScrollable();

	React.useEffect(() => {
		if (!canScrollToEarlierMessages && !isLoading) {
			onLoad();
		}
	}, [canScrollToEarlierMessages, isLoading, onLoad]);

	return (
		<MessageScrollerItem
			aria-busy={isLoading}
			aria-live="polite"
			className="flex min-h-8 items-center justify-center py-2"
			messageId={CHAT_HISTORY_LOADER_ID}
		>
			{isLoading ? (
				<>
					<LoaderCircle
						aria-hidden="true"
						className="animate-spin motion-reduce:animate-none"
					/>
					<span className="sr-only">Loading earlier messages</span>
				</>
			) : null}
		</MessageScrollerItem>
	);
}

export function ChatMessageListContent({
	messages,
	error,
	isLoading,
	className,
	turnClassName,
	textContainerClassName,
	errorClassName,
	hasEarlierMessages = false,
	historyMarkerState,
	compactionActivity,
	isLoadingEarlierMessages = false,
	onLoadEarlierMessages,
	scrollAnchorUserMessages = true,
	renderAssistantActions,
	renderUserActions,
	onOpenNote,
	streamingMessageIds,
}: {
	messages: UIMessage[];
	error?: Error;
	isLoading?: boolean;
	className?: string;
	turnClassName?: (isLastTurn: boolean) => string;
	textContainerClassName?: string;
	errorClassName?: string;
	hasEarlierMessages?: boolean;
	historyMarkerState?: ChatHistoryMarkerState;
	compactionActivity?: ChatCompactionActivity | null;
	isLoadingEarlierMessages?: boolean;
	onLoadEarlierMessages?: () => void;
	scrollAnchorUserMessages?: boolean;
	renderAssistantActions?: (
		context: ChatMessageActionContext,
	) => React.ReactNode;
	renderUserActions?: (context: ChatMessageActionContext) => React.ReactNode;
	onOpenNote?: (note: NoteReference) => void;
	streamingMessageIds?: ReadonlySet<string>;
}) {
	const {
		forcedStreamingMessageIds,
		lastMessageId,
		showAssistantBreathingSpace,
		turns,
	} = useChatTurnPresentation({
		isLoading,
		messages,
		scrollAnchorUserMessages,
		streamingMessageIds,
	});
	return (
		<MessageScrollerContent className={className}>
			{historyMarkerState?.kind === "fork" ? (
				<MessageScrollerItem messageId="chat-fork-marker">
					<Marker className="py-2">
						<MarkerIcon>
							<GitBranch className="size-4" />
						</MarkerIcon>
						<MarkerContent>Forked from another chat</MarkerContent>
					</Marker>
				</MessageScrollerItem>
			) : null}
			{historyMarkerState?.kind === "fork" &&
			historyMarkerState.historyOmittedBefore &&
			!hasEarlierMessages ? (
				<MessageScrollerItem messageId="chat-fork-history-omitted-marker">
					<Marker className="py-2" variant="separator">
						<MarkerContent>
							Earlier history was not copied into this fork.
						</MarkerContent>
					</Marker>
				</MessageScrollerItem>
			) : null}
			{hasEarlierMessages && onLoadEarlierMessages ? (
				<ChatHistoryLoader
					isLoading={isLoadingEarlierMessages}
					onLoad={onLoadEarlierMessages}
				/>
			) : null}
			{turns.map((turn) => {
				const firstAssistantIndex = turn.messages.findIndex(
					(message) => message.role === "assistant",
				);
				const workRowIndex =
					firstAssistantIndex === -1
						? turn.messages.length
						: firstAssistantIndex;
				const rows: React.ReactNode[] = turn.messages.map((message) => (
					<React.Fragment key={message.id}>
						<ChatMessageListItem
							message={message}
							isLoading={isLoading}
							lastMessageId={lastMessageId}
							renderAssistantActions={renderAssistantActions}
							renderUserActions={renderUserActions}
							onOpenNote={onOpenNote}
							scrollAnchor={scrollAnchorUserMessages && message.role === "user"}
							streamingMessageIds={forcedStreamingMessageIds}
							textContainerClassName={textContainerClassName}
						/>
						{message.id === compactionActivity?.anchorMessageId ? (
							<ConversationCompactionActivity activity={compactionActivity} />
						) : null}
					</React.Fragment>
				));

				if (turn.showAssistantWorkGroup) {
					rows.splice(
						workRowIndex,
						0,
						<ChatMessageAssistantWork
							key="assistant-turn-work"
							activity={{
								durationMs: turn.assistantTurnDurationMs,
								startedAt: turn.assistantTurnStartedAt ?? undefined,
								status: turn.assistantTurnWorkStatus,
								units: turn.assistantTurnActivityUnits,
							}}
							isInterrupted={turn.assistantTurnIsInterrupted}
							textContainerClassName={textContainerClassName}
						/>,
					);
				}

				return (
					<MessageScrollerItem
						key={turn.messages[0].id}
						messageId={turn.messages[0].id}
						scrollAnchor={turn.scrollAnchor}
						className={turnClassName?.(turn.isLastTurn)}
					>
						{rows}
					</MessageScrollerItem>
				);
			})}

			{showAssistantBreathingSpace ? (
				<MessageScrollerItem
					aria-hidden="true"
					className={cn(
						"w-full",
						isLoading ? "min-h-[max(140px,24vh)]" : "min-h-8",
					)}
					messageId="assistant-breathing-space"
				/>
			) : null}

			{error ? (
				<MessageScrollerItem
					className={cn("text-sm text-destructive", errorClassName)}
					messageId="chat-error"
				>
					<p>{error.message}</p>
				</MessageScrollerItem>
			) : null}
		</MessageScrollerContent>
	);
}

function ConversationCompactionActivity({
	activity,
}: {
	activity: ChatCompactionActivity;
}) {
	return (
		<Marker aria-live="polite" className="my-2">
			<MarkerIcon>
				<Scissors className="size-4" />
			</MarkerIcon>
			<MarkerContent>
				{activity.status === "running" ? (
					<ShimmerText as="span">Conversation compacting</ShimmerText>
				) : (
					"Conversation compacted"
				)}
			</MarkerContent>
		</Marker>
	);
}

const getChatMessagePresentation = ({
	isLoading,
	lastMessageId,
	message,
	streamingMessageIds,
}: {
	isLoading?: boolean;
	lastMessageId?: string;
	message: UIMessage;
	streamingMessageIds: ReadonlySet<string>;
}) => {
	const fileParts = extractMessageFileParts(message);
	const readNotes = extractReadNoteReferences(message);
	const chartArtifacts =
		message.role === "assistant"
			? extractChatChartArtifacts(message)
			: EMPTY_CHART_ARTIFACTS;
	const metadata = getChatMessageMetadata(message);
	const selectedRecipe = metadata?.recipe ?? null;
	const displayText = metadata?.recipeOnly
		? ""
		: message.role === "assistant"
			? getAssistantFinalText(message)
			: getChatText(message);
	const isInterruptedAssistantMessage =
		message.role === "assistant" &&
		(metadata?.interrupted === true || streamingMessageIds.has(message.id));
	const isStreamingAssistantMessage = Boolean(
		message.role === "assistant" &&
			!isInterruptedAssistantMessage &&
			isLoading &&
			message.id === lastMessageId,
	);

	return {
		chartArtifacts,
		displayText,
		fileParts,
		readNotes,
		isEmpty: displayText.length === 0,
		isInterruptedAssistantMessage,
		isStreamingAssistantMessage,
		metadata,
		selectedRecipe,
		timestamp: formatChatMessageTimestamp(getChatMessageTimestamp(message)),
	};
};

function ChatMessageActions({
	actionContext,
	presentation,
	renderAssistantActions,
	renderUserActions,
}: {
	actionContext: ChatMessageActionContext;
	presentation: ReturnType<typeof getChatMessagePresentation>;
	renderAssistantActions?: (
		context: ChatMessageActionContext,
	) => React.ReactNode;
	renderUserActions?: (context: ChatMessageActionContext) => React.ReactNode;
}) {
	if (actionContext.message.role === "assistant") {
		return presentation.isEmpty
			? null
			: renderAssistantActions?.(actionContext);
	}

	return !presentation.isEmpty ||
		presentation.selectedRecipe ||
		presentation.fileParts.length > 0
		? renderUserActions?.(actionContext)
		: null;
}

function ChatMessageAssistantWork({
	activity,
	isInterrupted,
	textContainerClassName,
}: {
	activity: {
		durationMs?: number;
		startedAt?: number;
		status: "streaming" | "ready";
		units?: AssistantActivityUnit[];
	};
	isInterrupted: boolean;
	textContainerClassName?: string;
}) {
	const units = React.useMemo(
		() =>
			(activity.units ?? EMPTY_ASSISTANT_ACTIVITY_UNITS).filter((unit) =>
				unit.kind === "commentary"
					? unit.part.text.trim().length > 0
					: filterSupersededChartToolFailures(unit.parts).some((part) =>
							isRenderableAssistantWorkPart(
								part,
								activity.status === "streaming",
							),
						),
			),
		[activity.units, activity.status],
	);

	return (
		<Message align="start" data-chat-assistant-work-row>
			<MessageContent className="w-[85%] items-start">
				<AssistantWorkGroup
					hasActivity={units.length > 0}
					status={activity.status}
					startedAt={activity.startedAt}
					totalDurationMs={activity.durationMs}
				>
					<AssistantActivitySequence
						units={units}
						chatStatus={activity.status}
						isInterrupted={isInterrupted}
						isStreaming={activity.status === "streaming"}
						textContainerClassName={textContainerClassName}
					/>
				</AssistantWorkGroup>
			</MessageContent>
		</Message>
	);
}

const ChatMessageListItem = React.memo(function ChatMessageListItem({
	message,
	isLoading,
	lastMessageId,
	renderAssistantActions,
	renderUserActions,
	onOpenNote,
	scrollAnchor,
	streamingMessageIds,
	textContainerClassName,
}: {
	message: UIMessage;
	isLoading?: boolean;
	lastMessageId?: string;
	renderAssistantActions?: (
		context: ChatMessageActionContext,
	) => React.ReactNode;
	renderUserActions?: (context: ChatMessageActionContext) => React.ReactNode;
	onOpenNote?: (note: NoteReference) => void;
	scrollAnchor: boolean;
	streamingMessageIds: ReadonlySet<string>;
	textContainerClassName?: string;
}) {
	const presentation = getChatMessagePresentation({
		isLoading,
		lastMessageId,
		message,
		streamingMessageIds,
	});

	if (
		presentation.isEmpty &&
		presentation.fileParts.length === 0 &&
		presentation.chartArtifacts.length === 0 &&
		presentation.readNotes.length === 0 &&
		!presentation.selectedRecipe
	) {
		return null;
	}

	const actionContext = {
		isStreamingAssistantMessage: presentation.isStreamingAssistantMessage,
		message,
		text: presentation.displayText,
		timestamp: presentation.timestamp,
	};

	return (
		<div
			data-chat-message-scroll-row={message.id}
			data-message-id={message.id}
			data-scroll-anchor={scrollAnchor ? "true" : "false"}
		>
			<Message
				align={message.role === "user" ? "end" : "start"}
				data-chat-message-id={message.id}
			>
				<MessageContent
					className={cn(
						message.role === "user" ? "items-end" : "items-start",
						message.role === "assistant"
							? "w-[85%]"
							: CHAT_MESSAGE_MAX_WIDTH_CLASS,
					)}
				>
					{presentation.selectedRecipe ? (
						<ChatRecipeReceipt recipe={presentation.selectedRecipe} />
					) : null}
					{message.role === "user" ? (
						<FileAttachmentCards align="end" files={presentation.fileParts} />
					) : null}
					<ChatChartArtifacts charts={presentation.chartArtifacts} />
					<ChatMessageText
						displayText={presentation.displayText}
						isInterruptedAssistantMessage={
							presentation.isInterruptedAssistantMessage
						}
						isStreamingAssistantMessage={
							presentation.isStreamingAssistantMessage
						}
						mentionPositions={presentation.metadata?.mentionPositions}
						onOpenNote={onOpenNote}
						role={message.role}
						textContainerClassName={textContainerClassName}
					/>
					{message.role === "assistant" ? (
						<>
							<FileAttachmentCards files={presentation.fileParts} />
							{presentation.readNotes.length > 0 ? (
								<div className="flex w-full max-w-full flex-col gap-3">
									{presentation.readNotes.map((note) => (
										<ChatNoteCard
											key={note.noteId}
											note={note}
											onOpenNote={onOpenNote}
										/>
									))}
								</div>
							) : null}
						</>
					) : null}
					{presentation.isInterruptedAssistantMessage ? (
						<InterruptedMessageStatus />
					) : null}
					<ChatMessageActions
						actionContext={actionContext}
						presentation={presentation}
						renderAssistantActions={renderAssistantActions}
						renderUserActions={renderUserActions}
					/>
				</MessageContent>
			</Message>
		</div>
	);
});

const AssistantActivitySequence = React.memo(
	function AssistantActivitySequence({
		chatStatus,
		isInterrupted,
		isStreaming,
		textContainerClassName,
		units,
	}: {
		chatStatus: "streaming" | "ready";
		isInterrupted: boolean;
		isStreaming: boolean;
		textContainerClassName?: string;
		units: AssistantActivityUnit[];
	}) {
		if (units.length === 0) {
			return null;
		}

		return (
			<div className="flex w-full flex-col gap-3">
				{units.map((unit) =>
					unit.kind === "commentary" ? (
						<div
							key={`${unit.messageId}:commentary:${unit.sourceIndex}`}
							className={cn(
								"w-full min-w-0 max-w-full",
								textContainerClassName,
							)}
						>
							<Bubble
								align="start"
								variant="ghost"
								className="w-auto max-w-full self-stretch"
							>
								<BubbleContent className={ASSISTANT_CHAT_CONTENT_CLASS}>
									<CollapsibleMessageContent
										messageRole="assistant"
										text={unit.part.text}
										isAnimating={
											isStreaming &&
											!isInterrupted &&
											unit.part.state !== "done"
										}
										mode={isStreaming || isInterrupted ? "streaming" : "static"}
									/>
								</BubbleContent>
							</Bubble>
						</div>
					) : (
						<AssistantActivityGroup
							key={`${unit.messageId}:activity:${unit.sourceIndex}`}
							chatStatus={chatStatus}
							parts={filterSupersededChartToolFailures(unit.parts)}
						/>
					),
				)}
			</div>
		);
	},
);

const filterSupersededChartToolFailures = (parts: UIMessage["parts"]) => {
	const hasSuccessfulChart = parts.some(
		(part) =>
			part.type === "tool-generate_chart" &&
			"state" in part &&
			part.state === "output-available",
	);

	if (!hasSuccessfulChart) {
		return parts;
	}

	return parts.filter(
		(part) =>
			part.type !== "tool-generate_chart" ||
			!("state" in part) ||
			part.state !== "output-error",
	);
};

const ChatMessageText = React.memo(function ChatMessageText({
	displayText,
	isInterruptedAssistantMessage,
	isStreamingAssistantMessage,
	mentionPositions,
	onOpenNote,
	role,
	textContainerClassName,
}: {
	displayText: string;
	isInterruptedAssistantMessage: boolean;
	isStreamingAssistantMessage: boolean;
	mentionPositions?: ChatMessageMention[];
	onOpenNote?: (note: NoteReference) => void;
	role: UIMessage["role"];
	textContainerClassName?: string;
}) {
	if (!displayText) {
		return null;
	}
	return (
		<div
			className={cn(
				"min-w-0 max-w-full",
				role === "assistant" && "w-full",
				textContainerClassName,
			)}
		>
			<Bubble
				align={role === "user" ? "end" : "start"}
				variant={role === "user" ? "secondary" : "ghost"}
				className={cn(
					role === "assistant"
						? "w-auto max-w-full self-stretch"
						: "max-w-full",
				)}
			>
				<BubbleContent
					className={cn(
						role === "user"
							? USER_CHAT_BUBBLE_CLASS
							: ASSISTANT_CHAT_CONTENT_CLASS,
					)}
				>
					{role === "user" && mentionPositions?.length ? (
						<UserMessageWithMentions
							text={displayText}
							mentionPositions={mentionPositions}
							onOpenNote={onOpenNote}
						/>
					) : (
						<CollapsibleMessageContent
							messageRole={role}
							text={displayText}
							isAnimating={
								isStreamingAssistantMessage && !isInterruptedAssistantMessage
							}
							mode={
								isStreamingAssistantMessage || isInterruptedAssistantMessage
									? "streaming"
									: "static"
							}
						/>
					)}
				</BubbleContent>
			</Bubble>
		</div>
	);
});

const InterruptedMessageStatus = React.memo(
	function InterruptedMessageStatus() {
		return (
			<Marker className="mt-2">
				<MarkerIcon>
					<CornerDownRight className="size-4" />
				</MarkerIcon>
				<MarkerContent>Response interrupted</MarkerContent>
			</Marker>
		);
	},
);

function UserMessageWithMentions({
	text,
	mentionPositions,
	onOpenNote,
}: {
	text: string;
	mentionPositions: ChatMessageMention[];
	onOpenNote?: (note: NoteReference) => void;
}) {
	const parts: React.ReactNode[] = [];
	let cursor = 0;
	const sortedMentions = [...mentionPositions]
		.filter(
			(mention) =>
				Number.isInteger(mention.from) &&
				Number.isInteger(mention.to) &&
				mention.from >= 0 &&
				mention.to > mention.from &&
				mention.from <= text.length,
		)
		.sort((a, b) => a.from - b.from);

	for (const mention of sortedMentions) {
		if (mention.from < cursor) {
			continue;
		}

		if (mention.from > cursor) {
			parts.push(text.slice(cursor, mention.from));
		}

		parts.push(
			mention.type === "tool" ? (
				<span
					key={`${mention.id}:${mention.from}`}
					className="inline-tool-mention"
					data-mention-id={mention.id}
					data-mention-type="tool"
					data-mention-provider={mention.provider}
				>
					<span
						aria-hidden="true"
						className="inline-tool-mention-icon"
						data-provider={mention.provider}
					>
						<AppSourceIcon
							provider={mention.provider}
							className="inline-tool-mention-svg"
						/>
					</span>
					<span className="inline-tool-mention-label">{mention.label}</span>
				</span>
			) : (
				<ChatNoteReference
					key={`${mention.id}:${mention.from}`}
					note={{ noteId: mention.id, title: mention.label }}
					onOpenNote={onOpenNote}
				/>
			),
		);
		cursor = Math.min(mention.to, text.length);
	}

	if (cursor < text.length) {
		parts.push(text.slice(cursor));
	}

	return <div className="whitespace-pre-wrap break-words">{parts}</div>;
}
