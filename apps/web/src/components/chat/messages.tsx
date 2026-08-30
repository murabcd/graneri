import { Button } from "@workspace/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { UIMessage } from "ai";
import {
	Check,
	Copy,
	GitBranch,
	PenLine,
	Plus,
	RotateCcw,
	Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { CHAT_ACTIONS_VISIBILITY_CLASS } from "@/components/chat/message-layout";
import {
	type ChatCompactionActivity,
	type ChatHistoryMarkerState,
	type ChatMessageActionContext,
	ChatMessageListContent,
} from "@/components/chat/message-list";
import type {
	ChatMessageMention,
	ChatRecipeReceipt,
} from "@/lib/chat-composer-mentions";
import { getChatMessageMetadata } from "@/lib/chat-message";

type ChatMessagesActionProps = {
	messageIdPendingDelete: string | null;
	onDeleteClick: (messageId: string) => void;
	onEditMessage?: (
		messageId: string,
		text: string,
		mentions: ChatMessageMention[],
		recipe: ChatRecipeReceipt | null,
	) => void;
	onDeleteMessage?: (messageId: string) => void;
	onForkMessage?: (messageId: string) => void;
	onPlusAction?: (
		message: UIMessage,
	) => Promise<"created" | undefined> | "created" | undefined;
	onRegenerateMessage?: (messageId: string) => void;
	setMessageIdPendingDelete: React.Dispatch<
		React.SetStateAction<string | null>
	>;
};

export type ChatMessagesProps = {
	messages: UIMessage[];
	error?: Error;
	hasEarlierMessages?: boolean;
	compactionActivity?: ChatCompactionActivity | null;
	historyMarkerState?: ChatHistoryMarkerState;
	isLoading?: boolean;
	isLoadingEarlierMessages?: boolean;
	onEditMessage?: (
		messageId: string,
		text: string,
		mentions: ChatMessageMention[],
		recipe: ChatRecipeReceipt | null,
	) => void;
	onDeleteMessage?: (messageId: string) => void;
	onForkMessage?: (messageId: string) => void;
	onPlusAction?: (
		message: UIMessage,
	) => Promise<"created" | undefined> | "created" | undefined;
	onRegenerateMessage?: (messageId: string) => void;
	onOpenMention?: (noteId: string) => void;
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
	onOpenMention,
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
			messageText,
			timestamp,
		}: ChatMessageActionContext) => (
			<AssistantMessageActions
				isStreaming={isStreamingAssistantMessage}
				message={message}
				messageText={messageText}
				onPlusAction={onPlusAction}
				onForkMessage={onForkMessage}
				onRegenerateMessage={onRegenerateMessage}
				timestamp={timestamp}
			/>
		),
		[onForkMessage, onPlusAction, onRegenerateMessage],
	);
	const renderUserActions = React.useCallback(
		({ message, messageText, timestamp }: ChatMessageActionContext) => {
			const metadata = getChatMessageMetadata(message);
			return (
				<UserMessageActions
					isPendingDelete={messageIdPendingDelete === message.id}
					messageId={message.id}
					messageText={messageText}
					mentions={metadata?.mentionPositions ?? []}
					recipe={metadata?.recipe ?? null}
					onDeleteClick={handleDeleteClick}
					onDeleteMessage={onDeleteMessage}
					onEditMessage={onEditMessage}
					setMessageIdPendingDelete={setMessageIdPendingDelete}
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
			onOpenMention={onOpenMention}
			streamingMessageIds={streamingMessageIds}
		/>
	);
}

function AssistantMessageActions({
	isStreaming,
	message,
	messageText,
	onPlusAction,
	onForkMessage,
	onRegenerateMessage,
	timestamp,
}: {
	isStreaming: boolean;
	message: UIMessage;
	messageText: string;
	onPlusAction?: ChatMessagesActionProps["onPlusAction"];
	onForkMessage?: (messageId: string) => void;
	onRegenerateMessage?: (messageId: string) => void;
	timestamp: string | null;
}) {
	return (
		<div
			className={cn(
				"mt-2 flex items-center gap-1",
				CHAT_ACTIONS_VISIBILITY_CLASS,
			)}
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="size-7 text-muted-foreground hover:text-foreground"
						aria-label="Regenerate"
						disabled={!onRegenerateMessage}
						onClick={() => onRegenerateMessage?.(message.id)}
					>
						<RotateCcw className="size-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Regenerate</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="size-7 text-muted-foreground hover:text-foreground"
						aria-label="Fork chat"
						disabled={!onForkMessage || isStreaming}
						onClick={() => onForkMessage?.(message.id)}
					>
						<GitBranch className="size-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Fork chat</TooltipContent>
			</Tooltip>
			<CopyMessageButton text={messageText} />
			<CreateNoteButton
				isStreaming={isStreaming}
				message={message}
				onPlusAction={onPlusAction}
			/>
			{timestamp ? (
				<span className="px-1 text-xs text-muted-foreground/70">
					{timestamp}
				</span>
			) : null}
		</div>
	);
}

function UserMessageActions({
	isPendingDelete,
	messageId,
	messageText,
	mentions,
	recipe,
	onDeleteClick,
	onDeleteMessage,
	onEditMessage,
	setMessageIdPendingDelete,
	timestamp,
}: {
	isPendingDelete: boolean;
	messageId: string;
	messageText: string;
	mentions: ChatMessageMention[];
	recipe: ChatRecipeReceipt | null;
	onDeleteClick: (messageId: string) => void;
	onDeleteMessage?: (messageId: string) => void;
	onEditMessage?: (
		messageId: string,
		text: string,
		mentions: ChatMessageMention[],
		recipe: ChatRecipeReceipt | null,
	) => void;
	setMessageIdPendingDelete: React.Dispatch<
		React.SetStateAction<string | null>
	>;
	timestamp: string | null;
}) {
	return (
		<div
			className={cn(
				"mt-2 flex justify-end gap-1",
				CHAT_ACTIONS_VISIBILITY_CLASS,
			)}
		>
			{timestamp ? (
				<span className="self-center px-1 text-xs text-muted-foreground/70">
					{timestamp}
				</span>
			) : null}
			{messageText || recipe ? (
				<>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="size-7 text-muted-foreground hover:text-foreground"
								aria-label="Edit"
								onClick={() =>
									onEditMessage?.(messageId, messageText, mentions, recipe)
								}
							>
								<PenLine className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Edit</TooltipContent>
					</Tooltip>
					<CopyMessageButton text={messageText || recipe?.name || ""} />
				</>
			) : null}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className={cn(
							"size-7 text-muted-foreground hover:text-foreground",
							isPendingDelete &&
								"text-destructive hover:bg-destructive/10 hover:text-destructive dark:text-red-500",
						)}
						aria-label="Delete"
						disabled={!onDeleteMessage}
						onClick={() => onDeleteClick(messageId)}
						onMouseLeave={() => {
							if (isPendingDelete) {
								setMessageIdPendingDelete(null);
							}
						}}
					>
						{isPendingDelete ? (
							<Check className="size-3.5" />
						) : (
							<Trash2 className="size-3.5" />
						)}
					</Button>
				</TooltipTrigger>
				{isPendingDelete ? null : <TooltipContent>Delete</TooltipContent>}
			</Tooltip>
		</div>
	);
}

function CopyMessageButton({ text }: { text: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="size-7 text-muted-foreground hover:text-foreground"
					aria-label="Copy"
					onClick={() => {
						void navigator.clipboard
							.writeText(text)
							.then(() => toast.success("Copied"))
							.catch(() => toast.error("Failed to copy"));
					}}
				>
					<Copy className="size-3.5" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>Copy</TooltipContent>
		</Tooltip>
	);
}

function CreateNoteButton({
	isStreaming,
	message,
	onPlusAction,
}: {
	isStreaming: boolean;
	message: UIMessage;
	onPlusAction?: ChatMessagesActionProps["onPlusAction"];
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="size-7 text-muted-foreground hover:text-foreground"
					aria-label="Create note"
					disabled={!onPlusAction || isStreaming}
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
				</Button>
			</TooltipTrigger>
			<TooltipContent>Create note</TooltipContent>
		</Tooltip>
	);
}
