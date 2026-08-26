import { Button } from "@workspace/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import { cn } from "@workspace/ui/lib/utils";
import { FileText } from "lucide-react";
import * as React from "react";
import type { AppUser } from "@/app/app-types";
import { NotesList } from "@/app/note-list";
import { PageTitle } from "@/components/layout/page-title";
import { ProjectDescriptionEditor } from "@/components/projects/project-description-editor";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

export function ProjectView({
	project,
	notes,
	currentNoteId,
	currentNoteTitle,
	currentUser,
	isDesktopMac,
	onOpenNote,
	onNoteTrashed,
	onCreateNote,
}: {
	project: Doc<"projects">;
	notes: Array<Doc<"notes">> | undefined;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle: string;
	currentUser: AppUser;
	isDesktopMac: boolean;
	onOpenNote: (noteId: Id<"notes">) => void;
	onNoteTrashed: (noteId: Id<"notes">) => void;
	onCreateNote: () => void;
}) {
	const projectNotes = React.useMemo(() => {
		if (!notes) {
			return notes;
		}

		return notes.filter((note) => note.projectId === project._id);
	}, [notes, project]);

	return (
		<div
			data-desktop-nonselectable
			className="box-border flex w-full max-w-full min-w-0 justify-center px-4 pb-6 md:px-6"
		>
			<div
				className={cn(
					"flex w-full min-w-0 max-w-5xl flex-col gap-6",
					isDesktopMac ? "pt-2 md:pt-4" : "pt-0",
				)}
			>
				<section className="mx-auto w-full min-w-0 space-y-6 md:max-w-xl">
					<PageTitle isDesktopMac={isDesktopMac}>{project.name}</PageTitle>
					<ProjectDescriptionEditor key={project._id} project={project} />
				</section>
				<section className="flex min-w-0 justify-center py-4">
					{projectNotes === undefined ? null : projectNotes.length > 0 ? (
						<div className="w-full md:max-w-xl">
							<NotesList
								notes={projectNotes}
								activeNoteId={currentNoteId}
								activeNoteTitle={currentNoteTitle}
								recordingNoteId={null}
								currentUser={currentUser}
								onOpenNote={onOpenNote}
								onNoteTrashed={onNoteTrashed}
							/>
						</div>
					) : (
						<Empty className="md:max-w-xl">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<FileText className="size-4" />
								</EmptyMedia>
								<EmptyTitle>No notes in this project</EmptyTitle>
								<EmptyDescription>
									Create a note to add it here
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button onClick={onCreateNote}>Quick note</Button>
							</EmptyContent>
						</Empty>
					)}
				</section>
			</div>
		</div>
	);
}
