"use client";

import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import * as React from "react";
import { NoteCommentsDeleteDialog } from "./note-comments-delete-dialog";
import type { ThreadComment } from "./note-comments-utils";

export function NoteCommentActionsMenu({
	comment,
	open,
	onOpenChange,
	onEdit,
	onDelete,
}: {
	comment: ThreadComment;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onEdit: (comment: ThreadComment) => void;
	onDelete: (comment: ThreadComment) => void;
}) {
	const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

	return (
		<>
			<DropdownMenu modal open={open} onOpenChange={onOpenChange}>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="size-6 cursor-pointer rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
						aria-label="Comment actions"
					>
						<MoreHorizontal className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					className="min-w-36"
					data-note-comments-preserve-expanded-thread
					onCloseAutoFocus={(event) => event.preventDefault()}
				>
					<DropdownMenuItem
						className="cursor-pointer"
						onSelect={() => onEdit(comment)}
					>
						<PencilLine className="size-4" />
						<span>Edit</span>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						className="cursor-pointer"
						onSelect={() => setDeleteDialogOpen(true)}
					>
						<Trash2 className="size-4" />
						<span>Delete</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<NoteCommentsDeleteDialog
				description="This action cannot be undone. This will permanently delete this comment."
				open={deleteDialogOpen}
				onOpenChange={setDeleteDialogOpen}
				onConfirm={() => onDelete(comment)}
			/>
		</>
	);
}
