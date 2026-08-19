import { BreadcrumbPage } from "@workspace/ui/components/breadcrumb";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@workspace/ui/components/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import * as React from "react";
import { NoteTitleEditInput } from "@/components/note/note-title-edit-input";
import { ProjectIdentityInput } from "@/components/projects/project-appearance-picker";
import { useProjectIdentityEditor } from "@/components/projects/use-project-identity-editor";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import type { BreadcrumbTitleEditorController } from "./use-breadcrumb-title-editor";

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
		typeof PopoverContent
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
			<PopoverContent
				align="start"
				side="bottom"
				sideOffset={6}
				className="w-85 rounded-lg border-sidebar-border/70 bg-sidebar p-1.5 shadow-2xl ring-1 ring-border/60"
				onOpenAutoFocus={onOpenAutoFocus}
			>
				{children}
			</PopoverContent>
		</Popover>
	);
}

export function RenameBreadcrumbTitleEditor({
	detailLabel,
	editor,
	isDesktopMac,
}: {
	detailLabel: string;
	editor: BreadcrumbTitleEditorController;
	isDesktopMac: boolean;
}) {
	return (
		<BreadcrumbTitlePopover
			detailLabel={detailLabel}
			isDesktopMac={isDesktopMac}
			itemLabel={editor.itemLabel}
			onOpen={editor.onOpen}
			onOpenChange={editor.onOpenChange}
			open={editor.open}
		>
			<NoteTitleEditInput
				focusOnMount
				commitOnBlur={false}
				placeholder={editor.placeholder}
				value={editor.value}
				onValueChange={editor.onValueChange}
				onCommit={editor.onCommit}
				onCancel={editor.onCancel}
			/>
		</BreadcrumbTitlePopover>
	);
}

export function ProjectBreadcrumbTitleEditor({
	detailLabel,
	isDesktopMac,
	project,
	workspaceId,
}: {
	detailLabel: string;
	isDesktopMac: boolean;
	project: Doc<"projects">;
	workspaceId: Id<"workspaces"> | null;
}) {
	const editor = useProjectIdentityEditor({ project, workspaceId });
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
			onOpen={editor.start}
			onOpenAutoFocus={handleOpenAutoFocus}
			onOpenChange={editor.onOpenChange}
			open={editor.open}
		>
			<ProjectIdentityInput
				inputRef={editor.inputRef}
				appearance={editor.draft}
				name={editor.draft.name}
				onAppearanceChange={editor.setAppearance}
				onNameChange={editor.setName}
				onCommit={() => {
					void editor.commit();
				}}
				onCancel={editor.cancel}
			/>
		</BreadcrumbTitlePopover>
	);
}
