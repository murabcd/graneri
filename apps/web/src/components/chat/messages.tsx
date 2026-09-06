import type { NoteReference } from "@workspace/ai/note-tools";
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
import { getChatMessageMetadata } from "@/lib/chat-message";

export type ChatMessagesProps = {
	messages: UIMessage[];
	error?: Error;
	hasEarlierMessages?: boolean;
	compactionActivity?: ChatCompactionActivity | null;
	historyMarkerState?: ChatHistoryMarkerState;
	isLoading?: boolean;
	isLoadingEarlierMessages?: boolean;
	onEditMessage?: (message: UIMessage) => void;
	onDeleteMessage?: (messageId: string) => void;
	onForkMessage?: (messageId: string) => void;
	onPlusAction?: (
		message: UIMessage,
	) => Promise<"created" | undefined> | "created" | undefined;
	onRegenerateMessage?: (messageId: string) => void;
	onOpenNote?: (note: NoteReference) => void;
	onLoadEarlierMessages?: () => void;
	streamingMessageIds?: ReadonlySet<string>;
};

export default function ChatMessages({
	messages,
	error,
	hasEarlierMessages,
	compactionActivity,
	historyMarkerState,
	isLoading,
	isLoadingEarlierMessages,
	onEditMessage,
	onDeleteMessage,
	onForkMessage,
	onPlusAction,
	onRegenerateMessage,
	onOpenNote,
	onLoadEarlierMessages,
	streamingMessageIds,
}: ChatMessagesProps) {
	const [messageIdPendingDelete, setMessageIdPendingDelete] = React.useState<
		string | null
	>(null);
	const handleDeleteClick = React.useCallback(
		(messageId: string) => {
			if (messageIdPendingDelete === messageId) {
				onDeleteMessage?.(messageId);
				setMessageIdPendingDelete(null);
				return;
			}

			setMessageIdPendingDelete(() => messageId);
		},
		[messageIdPendingDelete, onDeleteMessage],
	);
	const getTurnClassName = React.useCallback(
		(isLastTurn: boolean) => cn("flex flex-col gap-3", isLastTurn && "pb-9"),
		[],
	);
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
					<CreateNoteButton
						isStreaming={isStreamingAssistantMessage}
						message={message}
						onPlusAction={onPlusAction}
					/>
				}
			/>
		),
		[onForkMessage, onPlusAction, onRegenerateMessage],
	);
	const renderUserActions = React.useCallback(
		({ message, text, timestamp }: ChatMessageActionContext) => {
			const metadata = getChatMessageMetadata(message);
			return (
				<UserMessageActions
					copyText={text || metadata?.recipe?.name || undefined}
					isPendingDelete={messageIdPendingDelete === message.id}
					onDeleteMessage={
						onDeleteMessage ? () => handleDeleteClick(message.id) : undefined
					}
					onDeleteMouseLeave={() => {
						if (messageIdPendingDelete === message.id) {
							setMessageIdPendingDelete(null);
						}
					}}
					onEditMessage={
						onEditMessage ? () => onEditMessage(message) : undefined
					}
					timestamp={timestamp}
				/>
			);
		},
		[handleDeleteClick, messageIdPendingDelete, onDeleteMessage, onEditMessage],
	);

	return (
		<ChatMessageListContent
			className="gap-4"
			compactionActivity={compactionActivity}
			error={error}
			errorClassName="px-4"
			hasEarlierMessages={hasEarlierMessages}
			historyMarkerState={historyMarkerState}
			isLoading={isLoading}
			isLoadingEarlierMessages={isLoadingEarlierMessages}
			messages={messages}
			onLoadEarlierMessages={onLoadEarlierMessages}
			textContainerClassName="mt-2 flex flex-row items-start gap-2 first:mt-0"
			turnClassName={getTurnClassName}
			renderAssistantActions={renderAssistantActions}
			renderUserActions={renderUserActions}
			onOpenNote={onOpenNote}
			streamingMessageIds={streamingMessageIds}
		/>
	);
}

function CreateNoteButton({
	isStreaming,
	message,
	onPlusAction,
}: {
	isStreaming: boolean;
	message: UIMessage;
	onPlusAction?: ChatMessagesProps["onPlusAction"];
}) {
	return (
		<MessageActionButton
			disabled={!onPlusAction || isStreaming}
			label="Create note"
			onClick={() => {
				if (!onPlusAction) {
					return;
				}
				void Promise.resolve(onPlusAction(message))
					.then((result) => {
						if (result === "created") {
							toast.success("Note created");
						}
					})
					.catch(() => toast.error("Failed to create note"));
			}}
		>
			<Plus className="size-3.5" />
		</MessageActionButton>
	);
}
