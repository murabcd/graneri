import { Button } from "@workspace/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
	Check,
	Copy,
	GitBranch,
	PenLine,
	RotateCcw,
	Trash2,
} from "lucide-react";
import type * as React from "react";
import { toast } from "sonner";
import { CHAT_ACTIONS_VISIBILITY_CLASS } from "@/components/chat/message-layout";

const MESSAGE_ACTION_BUTTON_CLASS =
	"size-7 text-muted-foreground hover:text-foreground";

export function MessageActionButton({
	children,
	className,
	label,
	showTooltip = true,
	...props
}: Omit<
	React.ComponentProps<typeof Button>,
	"aria-label" | "size" | "variant"
> & {
	label: string;
	showTooltip?: boolean;
}) {
	const button = (
		<Button
			{...props}
			type="button"
			variant="ghost"
			size="icon-sm"
			className={cn(MESSAGE_ACTION_BUTTON_CLASS, className)}
			aria-label={label}
		>
			{children}
		</Button>
	);

	if (!showTooltip) {
		return button;
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>{button}</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

export function AssistantMessageActions({
	additionalAction,
	isStreaming,
	messageId,
	onForkMessage,
	onRegenerateMessage,
	text,
	timestamp,
}: {
	additionalAction?: React.ReactNode;
	isStreaming: boolean;
	messageId: string;
	onForkMessage?: (messageId: string) => void;
	onRegenerateMessage?: (messageId: string) => void;
	text: string;
	timestamp: string | null;
}) {
	return (
		<div
			className={cn(
				"mt-1 flex items-center gap-0.5",
				CHAT_ACTIONS_VISIBILITY_CLASS,
			)}
			data-message-actions="assistant"
		>
			<MessageActionButton
				disabled={!onRegenerateMessage}
				label="Regenerate"
				onClick={() => onRegenerateMessage?.(messageId)}
			>
				<RotateCcw className="size-3.5" />
			</MessageActionButton>
			<MessageActionButton
				disabled={!onForkMessage || isStreaming}
				label="Fork chat"
				onClick={() => onForkMessage?.(messageId)}
			>
				<GitBranch className="size-3.5" />
			</MessageActionButton>
			<CopyMessageButton text={text} />
			{additionalAction}
			{timestamp ? (
				<span className="px-1 text-xs text-muted-foreground/70">
					{timestamp}
				</span>
			) : null}
		</div>
	);
}

export function UserMessageActions({
	copyText,
	isPendingDelete = false,
	onDeleteMessage,
	onDeleteMouseLeave,
	onEditMessage,
	timestamp,
}: {
	copyText?: string;
	isPendingDelete?: boolean;
	onDeleteMessage?: () => void;
	onDeleteMouseLeave?: () => void;
	onEditMessage?: () => void;
	timestamp: string | null;
}) {
	return (
		<div
			className={cn(
				"mt-1 flex items-center justify-end gap-0.5",
				CHAT_ACTIONS_VISIBILITY_CLASS,
			)}
			data-message-actions="user"
		>
			{timestamp ? (
				<span className="self-center px-1 text-xs text-muted-foreground/70">
					{timestamp}
				</span>
			) : null}
			{onEditMessage ? (
				<MessageActionButton label="Edit" onClick={onEditMessage}>
					<PenLine className="size-3.5" />
				</MessageActionButton>
			) : null}
			{copyText ? <CopyMessageButton text={copyText} /> : null}
			<MessageActionButton
				className={
					isPendingDelete
						? "text-destructive hover:bg-destructive/10 hover:text-destructive dark:text-red-500"
						: undefined
				}
				disabled={!onDeleteMessage}
				label="Delete"
				onClick={onDeleteMessage}
				onMouseLeave={onDeleteMouseLeave}
				showTooltip={!isPendingDelete}
			>
				{isPendingDelete ? (
					<Check className="size-3.5" />
				) : (
					<Trash2 className="size-3.5" />
				)}
			</MessageActionButton>
		</div>
	);
}

function CopyMessageButton({ text }: { text: string }) {
	return (
		<MessageActionButton
			label="Copy"
			onClick={() => {
				void navigator.clipboard
					.writeText(text)
					.then(() => toast.success("Copied"))
					.catch(() => toast.error("Failed to copy"));
			}}
		>
			<Copy className="size-3.5" />
		</MessageActionButton>
	);
}
