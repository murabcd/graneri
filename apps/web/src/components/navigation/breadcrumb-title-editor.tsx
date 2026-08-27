import { BreadcrumbPage } from "@workspace/ui/components/breadcrumb";
import { Popover, PopoverAnchor } from "@workspace/ui/components/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import * as React from "react";
import { NoteTitleEditInput } from "@/components/note/note-title-edit-input";
import { useNoteTitleEditor } from "@/components/note/use-note-title-editor";
import {
	type ProjectAppearance,
	ProjectIdentityInput,
} from "@/components/projects/project-appearance-picker";
import type { ProjectAppearancePreview } from "@/components/projects/project-appearance-preview";
import { useProjectIdentityEditor } from "@/components/projects/use-project-identity-editor";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { RenamePopoverContent } from "./rename-popover";
import type { BreadcrumbChatTitleEditorController } from "./use-breadcrumb-chat-title-editor";

function BreadcrumbTitlePopover({
	detailLabel,
	isDesktopMac,
	itemLabel,
	onOpen,
	onOpenAutoFocus,
	onOpenChange,
	open,
	children,
}: {
	detailLabel: string;
	isDesktopMac: boolean;
	itemLabel: "chat" | "note" | "project";
	onOpen: () => void;
	onOpenAutoFocus?: React.ComponentProps<
		typeof RenamePopoverContent
	>["onOpenAutoFocus"];
	onOpenChange: (open: boolean) => void;
	open: boolean;
	children: React.ReactNode;
}) {
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverAnchor asChild>
						<button
							type="button"
							aria-current="page"
							data-app-region={isDesktopMac ? "no-drag" : undefined}
							className="line-clamp-1 -mx-1 -my-0.5 min-w-0 cursor-pointer rounded px-1 py-0.5 text-left"
							onClick={onOpen}
						>
							<BreadcrumbPage className="block truncate">
								{detailLabel}
							</BreadcrumbPage>
						</button>
					</PopoverAnchor>
				</TooltipTrigger>
				<TooltipContent>{`Rename ${itemLabel}`}</TooltipContent>
			</Tooltip>
			<RenamePopoverContent onOpenAutoFocus={onOpenAutoFocus}>
				{children}
			</RenamePopoverContent>
		</Popover>
	);
}

export function ChatBreadcrumbTitleEditor({
	detailLabel,
	editor,
	isDesktopMac,
}: {
	detailLabel: string;
	editor: BreadcrumbChatTitleEditorController;
	isDesktopMac: boolean;
}) {
	return (
		<BreadcrumbTitlePopover
			detailLabel={detailLabel}
			isDesktopMac={isDesktopMac}
			itemLabel="chat"
			onOpen={editor.start}
			onOpenChange={editor.onOpenChange}
			open={editor.open}
		>
			<NoteTitleEditInput
				focusOnMount
				commitOnBlur={false}
				placeholder="New chat"
				value={editor.value}
				onValueChange={editor.setValue}
				onCommit={() => {
					void editor.commit();
				}}
				onCancel={editor.cancel}
			/>
		</BreadcrumbTitlePopover>
	);
}

export function NoteBreadcrumbTitleEditor({
	detailLabel,
	isDesktopMac,
	noteId,
	onPreviewChange,
	title,
	workspaceId,
}: {
	detailLabel: string;
	isDesktopMac: boolean;
	noteId: Id<"notes">;
	onPreviewChange: (title: string) => void;
	title: string;
	workspaceId: Id<"workspaces"> | null;
}) {
	const editor = useNoteTitleEditor({
		noteId,
		onPreviewChange,
		title,
		workspaceId,
	});

	return (
		<BreadcrumbTitlePopover
			detailLabel={detailLabel}
			isDesktopMac={isDesktopMac}
			itemLabel="note"
			onOpen={editor.start}
			onOpenChange={editor.onOpenChange}
			open={editor.open}
		>
			<NoteTitleEditInput
				focusOnMount
				commitOnBlur={false}
				inputRef={editor.inputRef}
				value={editor.value}
				onValueChange={editor.setValue}
				onCommit={() => {
					void editor.commit();
				}}
				onCancel={editor.cancel}
			/>
		</BreadcrumbTitlePopover>
	);
}

export function ProjectBreadcrumbTitleEditor({
	detailLabel,
	isDesktopMac,
	onAppearancePreviewChange,
	project,
	workspaceId,
}: {
	detailLabel: string;
	isDesktopMac: boolean;
	onAppearancePreviewChange: (preview: ProjectAppearancePreview | null) => void;
	project: Doc<"projects">;
	workspaceId: Id<"workspaces"> | null;
}) {
	const editor = useProjectIdentityEditor({ project, workspaceId });
	const publishAppearancePreview = (appearance: ProjectAppearance) => {
		onAppearancePreviewChange({ projectId: project._id, ...appearance });
	};
	const start = () => {
		editor.start();
		publishAppearancePreview(project);
	};
	const commit = async () => {
		if (await editor.commit()) {
			onAppearancePreviewChange(null);
		}
	};
	const cancel = () => {
		editor.cancel();
		onAppearancePreviewChange(null);
	};
	const handleOpenChange = (open: boolean) => {
		if (open) {
			start();
			return;
		}

		void commit();
	};
	const handleAppearanceChange = (appearance: ProjectAppearance) => {
		editor.setAppearance(appearance);
		publishAppearancePreview(appearance);
	};
	React.useEffect(
		() => () => onAppearancePreviewChange(null),
		[onAppearancePreviewChange],
	);
	const handleOpenAutoFocus = React.useCallback(
		(event: Event) => {
			event.preventDefault();
			const input = editor.inputRef.current;
			input?.focus();
			input?.setSelectionRange(0, input.value.length);
		},
		[editor.inputRef],
	);

	return (
		<BreadcrumbTitlePopover
			detailLabel={detailLabel}
			isDesktopMac={isDesktopMac}
			itemLabel="project"
			onOpen={start}
			onOpenAutoFocus={handleOpenAutoFocus}
			onOpenChange={handleOpenChange}
			open={editor.open}
		>
			<ProjectIdentityInput
				inputRef={editor.inputRef}
				appearance={editor.draft}
				name={editor.draft.name}
				onAppearanceChange={handleAppearanceChange}
				onNameChange={editor.setName}
				onCommit={() => void commit()}
				onCancel={cancel}
			/>
		</BreadcrumbTitlePopover>
	);
}
