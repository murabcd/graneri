import { Bubble, BubbleContent } from "@workspace/ui/components/bubble";
import { Button } from "@workspace/ui/components/button";
import {
	Marker,
	MarkerContent,
	MarkerIcon,
} from "@workspace/ui/components/marker";
import { Message, MessageContent } from "@workspace/ui/components/message";
import {
	MessageScrollerContent,
	MessageScrollerItem,
} from "@workspace/ui/components/message-scroller";
import { cn } from "@workspace/ui/lib/utils";
import type { UIMessage } from "ai";
import {
	CornerDownRight,
	FileText,
	GitBranch,
	LoaderCircle,
	Scissors,
} from "lucide-react";
import * as React from "react";
import { FileAttachmentCards } from "@/components/ai-elements/file-attachment-cards";
import { ShimmerText } from "@/components/ai-elements/shimmer";
import {
	Source,
	Sources,
	SourcesContent,
	SourcesTrigger,
} from "@/components/ai-elements/sources";
import { ToolGroup } from "@/components/ai-elements/tools/tool-group";
import { AppSourceIcon } from "@/components/app-source-icon";
import { ChatChartArtifacts } from "@/components/chat/chat-chart-artifacts";
import { CollapsibleMessageContent } from "@/components/chat/collapsible-message-content";
import {
	ASSISTANT_CHAT_CONTENT_CLASS,
	CHAT_MESSAGE_MAX_WIDTH_CLASS,
	USER_CHAT_BUBBLE_CLASS,
} from "@/components/chat/message-layout";
import { ChatRecipeReceipt } from "@/components/chat/recipe-receipt";
import { useChatTurnPresentation } from "@/components/chat/use-chat-turn-presentation";
import { extractChatChartArtifacts } from "@/lib/chat-chart-artifact";
import type { ChatMessageMention } from "@/lib/chat-composer-mentions";
import {
	extractMessageFileParts,
	extractReasoningParts,
	extractToolParts,
	getChatMessageMetadata,
	getChatText,
} from "@/lib/chat-message";
import { collectMessageSources } from "@/lib/chat-sources";
import {
	formatChatMessageTimestamp,
	getChatMessageTimestamp,
} from "@/lib/chat-timestamp";

export type ChatMessageActionContext = {
	displayText: string;
	isStreamingAssistantMessage: boolean;
	message: UIMessage;
	messageText: string;
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

const EMPTY_MESSAGE_PARTS: UIMessage["parts"] = [];
const EMPTY_CHART_ARTIFACTS: ReturnType<typeof extractChatChartArtifacts> = [];
export function ChatMessageListContent({
	messages,
	error,
	isLoading,
	className,
	turnClassName,
	messageStackClassName,
	textContainerClassName,
	errorClassName,
	includeSources = true,
	hasEarlierMessages = false,
	historyMarkerState,
	compactionActivity,
	isLoadingEarlierMessages = false,
	onLoadEarlierMessages,
	scrollAnchorUserMessages = true,
	renderAssistantActions,
	renderUserActions,
	onOpenMention,
	streamingMessageIds,
}: {
	messages: UIMessage[];
	error?: Error;
	isLoading?: boolean;
	className?: string;
	turnClassName?: (isLastTurn: boolean) => string;
	messageStackClassName?: string;
	textContainerClassName?: string;
	errorClassName?: string;
	includeSources?: boolean;
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
	onOpenMention?: (noteId: string) => void;
	streamingMessageIds?: ReadonlySet<string>;
}) {
	const {
		forcedStreamingMessageIds,
		lastMessageId,
		showAssistantBreathingSpace,
		turns,
	} = useChatTurnPresentation({
		includeSources,
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
			{hasEarlierMessages ? (
				<MessageScrollerItem
					className="flex justify-center py-2"
					messageId="chat-history-loader"
				>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={isLoadingEarlierMessages}
						onClick={onLoadEarlierMessages}
					>
						{isLoadingEarlierMessages ? (
							<LoaderCircle className="animate-spin" />
						) : null}
						{isLoadingEarlierMessages
							? "Loading earlier messages"
							: "Load earlier messages"}
					</Button>
				</MessageScrollerItem>
			) : null}
			{turns.map((turn) => {
				return (
					<MessageScrollerItem
						key={turn.messages[0].id}
						messageId={turn.messages[0].id}
						scrollAnchor={turn.scrollAnchor}
						className={turnClassName?.(turn.isLastTurn)}
					>
						{turn.messages.map((message) => (
							<React.Fragment key={message.id}>
								<div
									data-chat-message-scroll-row={message.id}
									data-message-id={message.id}
									data-scroll-anchor={
										scrollAnchorUserMessages && message.role === "user"
											? "true"
											: "false"
									}
								>
									<ChatMessageListItem
										assistantTurnWorkParts={
											message.id === turn.firstAssistantMessageId &&
											turn.showAssistantWorkSummary
												? turn.assistantTurnWorkParts
												: undefined
										}
										assistantTurnWorkStatus={turn.assistantTurnWorkStatus}
										assistantTurnStartedAt={
											turn.assistantTurnStartedAt ?? undefined
										}
										assistantTurnDurationMs={turn.assistantTurnDurationMs}
										hasAssistantWorkInTurn={turn.hasAssistantWorkInTurn}
										message={message}
										includeSources={includeSources}
										isLoading={isLoading}
										lastMessageId={lastMessageId}
										messageStackClassName={messageStackClassName}
										renderAssistantActions={renderAssistantActions}
										renderUserActions={renderUserActions}
										onOpenMention={onOpenMention}
										streamingMessageIds={forcedStreamingMessageIds}
										textContainerClassName={textContainerClassName}
									/>
								</div>
								{message.id === compactionActivity?.anchorMessageId ? (
									<ConversationCompactionActivity
										activity={compactionActivity}
									/>
								) : null}
							</React.Fragment>
						))}
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

const ChatMessageListItem = React.memo(function ChatMessageListItem({
	assistantTurnWorkParts,
	assistantTurnWorkStatus,
	assistantTurnStartedAt,
	assistantTurnDurationMs,
	hasAssistantWorkInTurn,
	message,
	includeSources,
	isLoading,
	lastMessageId,
	messageStackClassName,
	renderAssistantActions,
	renderUserActions,
	onOpenMention,
	streamingMessageIds,
	textContainerClassName,
}: {
	assistantTurnWorkParts?: UIMessage["parts"];
	assistantTurnWorkStatus: "streaming" | "ready";
	assistantTurnStartedAt?: number;
	assistantTurnDurationMs?: number;
	hasAssistantWorkInTurn: boolean;
	message: UIMessage;
	includeSources: boolean;
	isLoading?: boolean;
	lastMessageId?: string;
	messageStackClassName?: string;
	renderAssistantActions?: (
		context: ChatMessageActionContext,
	) => React.ReactNode;
	renderUserActions?: (context: ChatMessageActionContext) => React.ReactNode;
	onOpenMention?: (noteId: string) => void;
	streamingMessageIds: ReadonlySet<string>;
	textContainerClassName?: string;
}) {
	const fileParts = extractMessageFileParts(message);
	const toolParts =
		message.role === "assistant"
			? filterSupersededChartToolFailures(extractToolParts(message))
			: EMPTY_MESSAGE_PARTS;
	const chartArtifacts =
		message.role === "assistant"
			? extractChatChartArtifacts(message)
			: EMPTY_CHART_ARTIFACTS;
	const reasoningParts =
		message.role === "assistant"
			? extractReasoningParts(message)
			: EMPTY_MESSAGE_PARTS;
	const metadata = getChatMessageMetadata(message);
	const selectedRecipe = metadata?.recipe ?? null;
	const messageText = metadata?.recipeOnly ? "" : getChatText(message);
	const displayText = messageText;
	const messageSources =
		includeSources && message.role === "assistant"
			? collectMessageSources(message)
			: [];
	const isInterruptedAssistantMessage =
		message.role === "assistant" &&
		(metadata?.interrupted === true || streamingMessageIds.has(message.id));
	const isStreamingAssistantMessage = Boolean(
		message.role === "assistant" &&
			!isInterruptedAssistantMessage &&
			isLoading &&
			message.id === lastMessageId,
	);
	const isEmpty = displayText.length === 0;
	const showThinkingPlaceholder = Boolean(
		isStreamingAssistantMessage && isEmpty && !hasAssistantWorkInTurn,
	);
	const timestamp = formatChatMessageTimestamp(
		getChatMessageTimestamp(message),
	);

	if (
		isEmpty &&
		assistantTurnWorkParts === undefined &&
		fileParts.length === 0 &&
		chartArtifacts.length === 0 &&
		reasoningParts.length === 0 &&
		toolParts.length === 0 &&
		!selectedRecipe &&
		!isStreamingAssistantMessage
	) {
		return null;
	}

	const actionContext = {
		displayText,
		isStreamingAssistantMessage,
		message,
		messageText,
		timestamp,
	};

	return (
		<Message
			align={message.role === "user" ? "end" : "start"}
			data-chat-message-id={message.id}
		>
			<MessageContent
				className={cn(
					message.role === "user" ? "items-end" : "items-start",
					CHAT_MESSAGE_MAX_WIDTH_CLASS,
					messageStackClassName,
				)}
			>
				{selectedRecipe ? <ChatRecipeReceipt recipe={selectedRecipe} /> : null}
				{message.role === "user" ? (
					<FileAttachmentCards align="end" files={fileParts} />
				) : null}
				{assistantTurnWorkParts ? (
					<ToolGroup
						parts={assistantTurnWorkParts}
						chatStatus={assistantTurnWorkStatus}
						startedAt={assistantTurnStartedAt}
						totalDurationMs={assistantTurnDurationMs}
					/>
				) : null}
				<ChatChartArtifacts charts={chartArtifacts} />
				<ChatMessageText
					displayText={displayText}
					isInterruptedAssistantMessage={isInterruptedAssistantMessage}
					isStreamingAssistantMessage={Boolean(isStreamingAssistantMessage)}
					mentionPositions={metadata?.mentionPositions}
					onOpenMention={onOpenMention}
					role={message.role}
					showThinkingPlaceholder={showThinkingPlaceholder}
					textContainerClassName={textContainerClassName}
				/>
				{message.role === "assistant" ? (
					<FileAttachmentCards files={fileParts} />
				) : null}
				{isInterruptedAssistantMessage ? <InterruptedMessageStatus /> : null}
				{message.role === "assistant" && !isEmpty
					? renderAssistantActions?.(actionContext)
					: null}
				{message.role === "user" && (!isEmpty || selectedRecipe)
					? renderUserActions?.(actionContext)
					: null}
				{messageSources.length > 0 ? (
					<MessageSources messageId={message.id} sources={messageSources} />
				) : null}
			</MessageContent>
		</Message>
	);
});

const filterSupersededChartToolFailures = (
	parts: ReturnType<typeof extractToolParts>,
) => {
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
	onOpenMention,
	role,
	showThinkingPlaceholder,
	textContainerClassName,
}: {
	displayText: string;
	isInterruptedAssistantMessage: boolean;
	isStreamingAssistantMessage: boolean;
	mentionPositions?: ChatMessageMention[];
	onOpenMention?: (noteId: string) => void;
	role: UIMessage["role"];
	showThinkingPlaceholder: boolean;
	textContainerClassName?: string;
}) {
	if (!displayText && !showThinkingPlaceholder) {
		return null;
	}
	return (
		<div className={textContainerClassName}>
			<Bubble
				align={role === "user" ? "end" : "start"}
				variant={role === "user" ? "secondary" : "ghost"}
				className="max-w-full"
			>
				<BubbleContent
					className={cn(
						role === "user"
							? USER_CHAT_BUBBLE_CLASS
							: ASSISTANT_CHAT_CONTENT_CLASS,
						showThinkingPlaceholder && "text-muted-foreground",
					)}
				>
					{showThinkingPlaceholder ? (
						<div className="text-sm text-muted-foreground">
							<ShimmerText>Thinking</ShimmerText>
						</div>
					) : role === "user" && mentionPositions?.length ? (
						<UserMessageWithMentions
							text={displayText}
							mentionPositions={mentionPositions}
							onOpenMention={onOpenMention}
						/>
					) : (
						<CollapsibleMessageContent
							role={role}
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
				<MarkerContent>Steered conversation</MarkerContent>
			</Marker>
		);
	},
);

function UserMessageWithMentions({
	text,
	mentionPositions,
	onOpenMention,
}: {
	text: string;
	mentionPositions: ChatMessageMention[];
	onOpenMention?: (noteId: string) => void;
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
				<span
					key={`${mention.id}:${mention.from}`}
					className="inline cursor-pointer align-baseline whitespace-nowrap text-inherit"
				>
					<FileText
						aria-hidden="true"
						className="mr-1 inline size-4 align-[-0.125em] text-blue-400"
					/>
					{onOpenMention ? (
						<button
							type="button"
							className="inline cursor-pointer bg-transparent p-0 text-left align-baseline font-medium text-blue-400 decoration-blue-300/80 decoration-dotted underline-offset-4 hover:underline"
							onClick={() => onOpenMention(mention.id)}
						>
							{mention.label}
						</button>
					) : (
						<span className="cursor-pointer font-medium text-blue-400 decoration-blue-300/80 decoration-dotted underline-offset-4 hover:underline">
							{mention.label}
						</span>
					)}
				</span>
			),
		);
		cursor = Math.min(mention.to, text.length);
	}

	if (cursor < text.length) {
		parts.push(text.slice(cursor));
	}

	return <div className="whitespace-pre-wrap break-words">{parts}</div>;
}

function MessageSources({
	messageId,
	sources,
}: {
	messageId: string;
	sources: ReturnType<typeof collectMessageSources>;
}) {
	return (
		<Sources defaultOpen={false} className="mt-1">
			<SourcesTrigger count={sources.length} />
			<SourcesContent>
				{sources.map((source) => (
					<Source
						key={`${messageId}:${source.href}`}
						href={source.href}
						title={source.title}
					/>
				))}
			</SourcesContent>
		</Sources>
	);
}
