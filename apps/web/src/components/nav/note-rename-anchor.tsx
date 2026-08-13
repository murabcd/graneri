import { Icons } from "@workspace/ui/components/icons";
import { SidebarMenuButton } from "@workspace/ui/components/sidebar";
import { FileText } from "lucide-react";
import { HoverScrollTitle } from "@/components/hover-scroll-title";
import type { Id } from "../../../../../convex/_generated/dataModel";

const SidebarRecordingSpinner = Icons.sidebarRecordingSpinner;

export function NoteRenameAnchor({
	displayTitle,
	isActive,
	isRecording,
	noteId,
	onNoteSelect,
	onPrefetchNote,
}: {
	displayTitle: string;
	isActive: boolean;
	isRecording: boolean;
	noteId: Id<"notes">;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onPrefetchNote: (noteId: Id<"notes">) => void;
}) {
	return (
		<SidebarMenuButton
			className="transition-[width,height,background-color,color,transform] group-has-data-[sidebar=menu-action]/note-row:pr-2 group-hover/note-row:pr-8! group-has-data-[state=open]/note-row:pr-8!"
			isActive={isActive}
			onFocus={() => onPrefetchNote(noteId)}
			onMouseEnter={() => onPrefetchNote(noteId)}
			onPointerDown={() => onPrefetchNote(noteId)}
			onClick={() => onNoteSelect(noteId)}
		>
			{isRecording ? <SidebarRecordingSpinner /> : <FileText />}
			<HoverScrollTitle keepFadeOnHover>{displayTitle}</HoverScrollTitle>
		</SidebarMenuButton>
	);
}
