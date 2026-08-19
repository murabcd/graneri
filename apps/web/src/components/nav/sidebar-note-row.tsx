import { Icons } from "@workspace/ui/components/icons";
import {
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { FileText, MoreHorizontal } from "lucide-react";
import { HoverScrollTitle } from "@/components/hover-scroll-title";
import { NoteActionsMenu } from "@/components/note/note-actions-menu";
import { getNoteDisplayTitle } from "@/lib/note-title";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

const SidebarRecordingSpinner = Icons.sidebarRecordingSpinner;

export function SidebarNoteRow({
	note,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId,
	onPrefetchNote,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
}: {
	note: Doc<"notes">;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId: Id<"notes"> | null;
	onPrefetchNote: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
}) {
	const isActive = note._id === currentNoteId;
	const isRecording = note._id === recordingNoteId;
	const title =
		isActive && currentNoteTitle?.trim() ? currentNoteTitle : note.title;
	const displayTitle = getNoteDisplayTitle(title);
	const renameAnchor = (
		<SidebarMenuButton
			className="group-has-data-[sidebar=menu-action]/note-row:pr-2 group-hover/note-row:pr-8! group-has-data-[state=open]/note-row:pr-8!"
			isActive={isActive}
			onFocus={() => onPrefetchNote(note._id)}
			onMouseEnter={() => onPrefetchNote(note._id)}
			onPointerDown={() => onPrefetchNote(note._id)}
			onClick={() => onNoteSelect(note._id)}
		>
			{isRecording ? <SidebarRecordingSpinner /> : <FileText />}
			<HoverScrollTitle keepFadeOnHover>{displayTitle}</HoverScrollTitle>
		</SidebarMenuButton>
	);

	return (
		<SidebarMenuItem
			className="group/note-row list-none"
			data-hover-scroll-title-row
		>
			<NoteActionsMenu
				noteId={note._id}
				onMoveToTrash={onNoteTrashed}
				align="start"
				side="right"
				renameAnchor={renameAnchor}
				renamePopoverAlign="start"
				renamePopoverSide="bottom"
				renamePopoverSideOffset={6}
				renamePopoverClassName="w-[340px] rounded-lg border-sidebar-border/70 bg-sidebar p-1.5 shadow-2xl ring-1 ring-border/60"
				onRenamePreviewChange={isActive ? onNoteTitleChange : undefined}
			>
				<SidebarMenuAction
					className="pointer-events-none cursor-pointer opacity-0 transition-opacity group-hover/note-row:pointer-events-auto group-hover/note-row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:text-sidebar-accent-foreground data-[state=open]:opacity-100"
					aria-label={`Open actions for ${displayTitle}`}
				>
					<MoreHorizontal />
				</SidebarMenuAction>
			</NoteActionsMenu>
		</SidebarMenuItem>
	);
}
