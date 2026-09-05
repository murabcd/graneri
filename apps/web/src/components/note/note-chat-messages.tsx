import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import type { UIMessage } from "ai";
import { cn } from "cn";
import { Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
	AssistantMessageActions,
	MessageActionButton,
	UserMessageActions,
} from "@/components/chat/message-actions";
import {
	type ChatCompactionActivity,
	type ChatHistoryMarkerState,
	type ChatMessageActionContext,
	ChatMessageListContent,
} from "@/components/chat/message-list";
import { NOTE_POPOVER_SCROLLER_BUTTON_CLASS } from "./note-popover-scroll";

type NoteChatHistoryPagination =
	| { status: "complete" }
	| {
			status: "available" | "loading";
			onLoad: () => void;
	  };

const COMPLETE_CHAT_HISTORY: NoteChatHistoryPagination = {
	status: "complete",
};

export type NoteChatMessagesProps = {
	chatError: Error | undefined;
	chatMessages: UIMessage[];
	compactionActivity?: ChatCompactionActivity | null;
	disableAddToNote: boolean;
	disablePadding: boolean;
	historyPagination?: NoteChatHistoryPagination;
	historyMarkerState?: ChatHistoryMarkerState;
	isChatLoading: boolean;
	onAddMessageToNote?: (text: string) => Promise<void> | void;
	onDeleteMessage?: (messageId: string) => void;
	onEditMessage?: (messageId: string, text: string) => void;
	onForkMessage?: (messageId: string) => void;
	onRegenerateMessage?: (messageId: string) => void;
	streamingMessageIds?: ReadonlySet<string>;
};

export default function NoteChatMessages({
	chatError,
	chatMessages,
	compactionActivity,
	disableAddToNote,
	disablePadding,
	historyPagination = COMPLETE_CHAT_HISTORY,
	historyMarkerState,
	isChatLoading,
	onAddMessageToNote,
	onDeleteMessage,
	onEditMessage,
	onForkMessage,
	onRegenerateMessage,
	streamingMessageIds,
}: NoteChatMessagesProps) {
	const hasEarlierMessages = historyPagination.status !== "complete";
	const isLoadingEarlierMessages = historyPagination.status === "loading";
	const onLoadEarlierMessages =
		historyPagination.status === "complete"
			? undefined
			: historyPagination.onLoad;
	const getTurnClassName = React.useCallback(() => "flex flex-col gap-3", []);
	const renderAssistantActions = React.useCallback(
		({
			isStreamingAssistantMessage,
			message,
			text,
			timestamp,
		}: ChatMessageActionContext) => (
			<AssistantMessageActions
				isStreaming={isStreamingAssistantMessage}
				messageId={message.id}
				onForkMessage={onForkMessage}
				onRegenerateMessage={onRegenerateMessage}
				text={text}
				timestamp={timestamp}
				additionalAction={
					<NoteAddToNoteButton
						disabled={disableAddToNote}
						onAddMessageToNote={onAddMessageToNote}
						text={text}
					/>
				}
			/>
		),
		[disableAddToNote, onAddMessageToNote, onForkMessage, onRegenerateMessage],
	);
	const renderUserActions = React.useCallback(
		({ message, text, timestamp }: ChatMessageActionContext) => (
			<UserMessageActions
				copyText={text || undefined}
				onDeleteMessage={
					onDeleteMessage ? () => onDeleteMessage(message.id) : undefined
				}
				onEditMessage={
					onEditMessage && text
						? () => onEditMessage(message.id, text)
						: undefined
				}
				timestamp={timestamp}
			/>
		),
		[onDeleteMessage, onEditMessage],
	);

	return (
		<MessageScrollerProvider defaultScrollPosition="last-anchor">
			<MessageScroller className="min-h-0 flex-1">
				<MessageScrollerViewport
					className={cn(
						"flex min-h-full flex-col gap-4 pr-4 pb-2",
						disablePadding && "px-2",
					)}
				>
					<ChatMessageListContent
						compactionActivity={compactionActivity}
						error={chatError}
						hasEarlierMessages={hasEarlierMessages}
						historyMarkerState={historyMarkerState}
						isLoading={isChatLoading}
						isLoadingEarlierMessages={isLoadingEarlierMessages}
						messages={chatMessages}
						onLoadEarlierMessages={onLoadEarlierMessages}
						turnClassName={getTurnClassName}
						renderAssistantActions={renderAssistantActions}
						renderUserActions={renderUserActions}
						streamingMessageIds={streamingMessageIds}
					/>
				</MessageScrollerViewport>
				{chatMessages.length > 0 ? (
					<MessageScrollerButton
						aria-label="Scroll to latest messages"
						className={NOTE_POPOVER_SCROLLER_BUTTON_CLASS}
					/>
				) : null}
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

function NoteAddToNoteButton({
	disabled,
	onAddMessageToNote,
	text,
}: {
	disabled: boolean;
	onAddMessageToNote?: (text: string) => Promise<void> | void;
	text: string;
}) {
	return (
		<MessageActionButton
			disabled={disabled || !onAddMessageToNote}
			label="Add to note"
			onClick={() => {
				if (!onAddMessageToNote) {
					return;
				}

				void Promise.resolve(onAddMessageToNote(text)).catch(() =>
					toast.error("Failed to add"),
				);
			}}
		>
			<Plus className="size-3.5" />
		</MessageActionButton>
	);
}
