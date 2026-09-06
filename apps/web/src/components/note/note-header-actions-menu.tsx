import { Button } from "@workspace/ui/components/button";
import { DropdownMenuItem } from "@workspace/ui/components/dropdown-menu";
import { ArrowDown, Copy, MoreHorizontal, Redo2, Undo2 } from "lucide-react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { NoteActionsMenu } from "./note-actions-menu";
import type { NoteEditorActions } from "./note-editor-actions-store";

export function NoteHeaderActionsMenu({
	noteId,
	noteTitle,
	noteEditorActions,
	onNoteTrashed,
	onRename,
}: {
	onRename: () => void;
	noteId: Id<"notes">;
	noteTitle: string;
	noteEditorActions: NoteEditorActions | null;
	onNoteTrashed: (noteId: Id<"notes">) => void;
}) {
	const itemsBeforeDefaults = noteEditorActions ? (
		<DropdownMenuItem
			className="cursor-pointer"
			disabled={!noteEditorActions.canCopyContent}
			onSelect={() => {
				void noteEditorActions.copyContent();
			}}
		>
			<Copy />
			Copy note content
		</DropdownMenuItem>
	) : null;
	const itemsAfterDefaults = noteEditorActions ? (
		<>
			<DropdownMenuItem
				className="cursor-pointer"
				disabled={!noteEditorActions.canUndo}
				onSelect={(event) => {
					event.preventDefault();
					noteEditorActions.undo();
				}}
			>
				<Undo2 />
				Undo
			</DropdownMenuItem>
			<DropdownMenuItem
				className="cursor-pointer"
				disabled={!noteEditorActions.canRedo}
				onSelect={(event) => {
					event.preventDefault();
					noteEditorActions.redo();
				}}
			>
				<Redo2 />
				Redo
			</DropdownMenuItem>
			<DropdownMenuItem
				className="cursor-pointer"
				disabled={!noteEditorActions.canCopyContent}
				onSelect={() => {
					void noteEditorActions.exportMarkdown();
				}}
			>
				<ArrowDown />
				Export
			</DropdownMenuItem>
		</>
	) : null;

	return (
		<NoteActionsMenu
			onRename={onRename}
			noteId={noteId}
			onMoveToTrash={onNoteTrashed}
			align="end"
			triggerTooltip="More actions"
			itemsBeforeDefaults={itemsBeforeDefaults}
			itemsAfterDefaults={itemsAfterDefaults}
		>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="text-muted-foreground hover:text-foreground"
				aria-label={`Open actions for ${noteTitle || "note"}`}
			>
				<MoreHorizontal className="size-4" />
			</Button>
		</NoteActionsMenu>
	);
}
