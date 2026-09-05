import type { Editor } from "@tiptap/core";
import { Tiptap } from "@tiptap/react";
import {
	InputGroupAddon,
	InputGroupButton,
} from "@workspace/ui/components/input-group";
import type { FileUIPart } from "ai";
import { cn } from "cn";
import { ArrowUp, Play, Square } from "lucide-react";
import type * as React from "react";
import {
	FileAttachmentButton,
	FileAttachmentChips,
} from "@/components/ai-elements/file-attachment-controls";
import type { ChatAttachment } from "@/components/ai-elements/file-attachment-utils";
import type { ChatComposerPrimaryAction } from "@/components/chat/chat-composer-primary-action";
import {
	type ChatModel,
	ChatModelPicker,
	type ReasoningEffort,
	type ServiceTier,
} from "@/components/chat/model-picker";

export const NOTE_COMPOSER_FOOTER_SURFACE_CLASS =
	"min-h-[132px] max-w-full overflow-hidden rounded-lg border-input/30 bg-background bg-clip-padding shadow-sm has-disabled:bg-background has-disabled:opacity-100 data-[drag-over=true]:border-ring data-[drag-over=true]:ring-3 data-[drag-over=true]:ring-ring/50 dark:bg-input/30 dark:has-disabled:bg-input/30";
export const NOTE_COMPOSER_FOOTER_TOP_ROW_CLASS =
	"min-w-0 flex-wrap gap-1 px-4 pb-0 pt-2.5";
export const NOTE_COMPOSER_FOOTER_BODY_CLASS =
	"min-h-[44px] max-h-[24rem] overflow-y-auto pb-0 text-[14px] leading-[1.6] font-normal placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0";
export const NOTE_COMPOSER_FOOTER_BODY_SPACER_CLASS =
	"min-h-[40px] w-full shrink-0 px-4 pt-2 pb-0";
export const NOTE_COMPOSER_FOOTER_BOTTOM_ROW_CLASS =
	"min-w-0 flex-wrap gap-1 px-4 pb-2.5";

export type ChatInlinePopoverStatus = {
	activateInlineOnFocus: boolean;
	isRecipeLoading: boolean;
	canSendMessage: boolean;
	canStop: boolean;
	hasInterruptedQueue: boolean;
	isChatLoading: boolean;
	isResumingQueuedFollowUps: boolean;
	isSidebarCompact: boolean;
	showModelPicker: boolean;
};

export function ChatInlineAttachmentRow({
	attachedFiles,
	isSidebarCompact,
	onAttachedFilesChange,
}: {
	attachedFiles: ChatAttachment[];
	isSidebarCompact: boolean;
	onAttachedFilesChange: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
}) {
	if (attachedFiles.length === 0) {
		return null;
	}

	return (
		<InputGroupAddon
			align="block-start"
			className={cn(
				NOTE_COMPOSER_FOOTER_TOP_ROW_CLASS,
				isSidebarCompact && "px-3.5",
			)}
		>
			<FileAttachmentChips
				files={attachedFiles}
				onRemove={(index) =>
					onAttachedFilesChange(
						attachedFiles.filter((_, fileIndex) => fileIndex !== index),
					)
				}
			/>
		</InputGroupAddon>
	);
}

export function ChatInlineEditorField({
	activateInlineOnFocus,
	composerEditor,
	composerEditorRef,
	handleComposerFocus,
	handleComposerPointerDown,
	isSidebarCompact,
}: {
	activateInlineOnFocus: boolean;
	composerEditor: Editor | null;
	composerEditorRef: React.RefObject<HTMLDivElement | null>;
	handleComposerFocus: () => void;
	handleComposerPointerDown: () => void;
	isSidebarCompact: boolean;
}) {
	return (
		<div
			data-slot="input-group-control"
			ref={composerEditorRef}
			className={cn(
				NOTE_COMPOSER_FOOTER_BODY_CLASS,
				"chat-composer-editor relative flex w-full flex-1 cursor-text",
				isSidebarCompact && "[&_.chat-composer-tiptap]:px-3.5",
			)}
			onFocusCapture={() => {
				if (activateInlineOnFocus) {
					handleComposerFocus();
				}
			}}
			onPointerDownCapture={() => {
				if (activateInlineOnFocus) {
					handleComposerPointerDown();
				}
			}}
		>
			{activateInlineOnFocus ? (
				<button
					type="button"
					className="absolute inset-0 z-10 cursor-text bg-transparent p-0 text-left"
					aria-label="Open follow-up chat"
					onClick={handleComposerPointerDown}
					onPointerDown={(event) => {
						event.preventDefault();
						event.stopPropagation();
						handleComposerPointerDown();
					}}
				/>
			) : null}
			{composerEditor ? (
				<Tiptap editor={composerEditor}>
					<Tiptap.Content />
				</Tiptap>
			) : null}
		</div>
	);
}

function ChatInlinePrimaryActionButton({
	onResume,
	onStop,
	primaryAction,
	showModelPicker,
	submitDisabled,
}: {
	onResume: () => void;
	onStop: () => void;
	primaryAction: ChatComposerPrimaryAction;
	showModelPicker: boolean;
	submitDisabled: boolean;
}) {
	return (
		<InputGroupButton
			type={primaryAction === "send" ? "submit" : "button"}
			variant="default"
			size="icon-sm"
			className={cn("rounded-full", !showModelPicker && "ml-auto")}
			aria-label={
				primaryAction === "stop"
					? "Stop streaming"
					: primaryAction === "resume"
						? "Resume"
						: "Send message"
			}
			disabled={submitDisabled}
			onClick={
				primaryAction === "stop"
					? onStop
					: primaryAction === "resume"
						? onResume
						: undefined
			}
		>
			{primaryAction === "stop" ? (
				<Square className="size-3.5 fill-current" />
			) : primaryAction === "resume" ? (
				<Play className="size-4 fill-current" />
			) : (
				<ArrowUp className="size-4" />
			)}
		</InputGroupButton>
	);
}

export function ChatInlineComposerControls({
	handleAttachmentUploadFailed,
	handleAttachmentUploaded,
	handleAttachmentsAdded,
	modelPopoverOpen,
	onModelPopoverOpenChange,
	onReasoningEffortChange,
	onResume,
	onSelectedModelChange,
	onServiceTierChange,
	onStop,
	primaryAction,
	reasoningEffort,
	selectedModel,
	serviceTier,
	speechControls,
	status,
	submitDisabled,
}: {
	handleAttachmentUploadFailed: (id: string) => void;
	handleAttachmentUploaded: (id: string, uploadedFile: FileUIPart) => void;
	handleAttachmentsAdded: (files: ChatAttachment[]) => void;
	modelPopoverOpen: boolean;
	onModelPopoverOpenChange: (open: boolean) => void;
	onReasoningEffortChange: (value: ReasoningEffort) => void;
	onResume: () => void;
	onSelectedModelChange: (model: ChatModel) => void;
	onServiceTierChange: (value: ServiceTier) => void;
	onStop: () => void;
	primaryAction: ChatComposerPrimaryAction;
	reasoningEffort: ReasoningEffort;
	selectedModel: ChatModel;
	serviceTier: ServiceTier;
	speechControls: React.ReactNode;
	status: Pick<
		ChatInlinePopoverStatus,
		| "activateInlineOnFocus"
		| "isChatLoading"
		| "isSidebarCompact"
		| "showModelPicker"
	>;
	submitDisabled: boolean;
}) {
	const {
		activateInlineOnFocus,
		isChatLoading,
		isSidebarCompact,
		showModelPicker,
	} = status;

	return (
		<InputGroupAddon
			align="block-end"
			className={cn(
				NOTE_COMPOSER_FOOTER_BOTTOM_ROW_CLASS,
				isSidebarCompact ? "flex-nowrap pl-3.5 pr-2.5" : "px-2",
			)}
		>
			{!activateInlineOnFocus ? (
				<FileAttachmentButton
					disabled={isChatLoading}
					onFileUploadFailed={handleAttachmentUploadFailed}
					onFileUploaded={handleAttachmentUploaded}
					onFilesAdded={handleAttachmentsAdded}
				/>
			) : null}
			{speechControls}
			{showModelPicker ? (
				<div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1">
					<ChatModelPicker
						open={modelPopoverOpen}
						onOpenChange={onModelPopoverOpenChange}
						selectedModel={selectedModel}
						onSelectedModelChange={onSelectedModelChange}
						reasoningEffort={reasoningEffort}
						onReasoningEffortChange={onReasoningEffortChange}
						serviceTier={serviceTier}
						onServiceTierChange={onServiceTierChange}
						triggerClassName="min-w-0 max-w-full text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
						triggerIconClassName="text-current"
						modelNameClassName="min-w-0 max-w-[120px] truncate"
					/>
				</div>
			) : null}
			<ChatInlinePrimaryActionButton
				onResume={onResume}
				onStop={onStop}
				primaryAction={primaryAction}
				showModelPicker={showModelPicker}
				submitDisabled={submitDisabled}
			/>
		</InputGroupAddon>
	);
}
