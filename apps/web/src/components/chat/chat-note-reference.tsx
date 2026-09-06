import type { NoteReference } from "@workspace/ai/note-tools";
import {
	AttachmentAction,
	AttachmentActions,
	AttachmentCard,
	AttachmentCardIcon,
	AttachmentContent,
	AttachmentDescription,
	AttachmentTitle,
	AttachmentTrigger,
} from "@workspace/ui/components/attachment";
import { FileText, SquareArrowOutUpRight } from "lucide-react";
import { createNoteSearch } from "@/app/location";
import { navigateToAppLocation } from "@/lib/app-navigation";
import type { ReadNoteReference } from "@/lib/chat-note-references";

export function ChatNoteReference({
	note,
	onOpenNote,
}: {
	note: NoteReference;
	onOpenNote?: (note: NoteReference) => void;
}) {
	return (
		<span className="inline align-baseline whitespace-nowrap text-inherit">
			<FileText
				aria-hidden="true"
				className="mr-1 inline size-4 align-[-0.125em] text-blue-400"
			/>
			{onOpenNote ? (
				<button
					type="button"
					className="inline cursor-pointer bg-transparent p-0 text-left align-baseline font-medium text-blue-400 decoration-blue-300/80 decoration-dotted underline-offset-4 hover:underline"
					onClick={() => onOpenNote(note)}
				>
					{note.title}
				</button>
			) : (
				<span className="font-medium text-blue-400">{note.title}</span>
			)}
		</span>
	);
}

export function ChatNoteCard({
	note,
	onOpenNote,
}: {
	note: ReadNoteReference;
	onOpenNote?: (note: NoteReference) => void;
}) {
	return (
		<AttachmentCard>
			<AttachmentCardIcon>
				<FileText
					aria-hidden="true"
					className="size-6 shrink-0 text-blue-400"
				/>
			</AttachmentCardIcon>
			<AttachmentContent className="leading-5">
				<AttachmentTitle className="text-foreground text-sm" title={note.title}>
					{note.title}
				</AttachmentTitle>
				<AttachmentDescription className="mt-0 text-[13px]">
					{note.project?.name ?? "No project"}
				</AttachmentDescription>
			</AttachmentContent>
			{onOpenNote ? (
				<AttachmentTrigger
					aria-label={note.title}
					onClick={() => onOpenNote(note)}
				/>
			) : null}
			<AttachmentActions>
				<AttachmentAction
					aria-label={`Redirect to ${note.title}`}
					tooltip="Redirect"
					onClick={() =>
						navigateToAppLocation(
							`/note${createNoteSearch({ noteId: note.noteId })}`,
						)
					}
					className="rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
					size="icon-sm"
					type="button"
				>
					<SquareArrowOutUpRight aria-hidden="true" />
				</AttachmentAction>
			</AttachmentActions>
		</AttachmentCard>
	);
}
