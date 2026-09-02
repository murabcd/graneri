import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronsUp, MoreHorizontal, Plus } from "lucide-react";
import * as React from "react";
import {
	SIDEBAR_COLLAPSIBLE_GROUP_ACTION_CLASS_NAME,
	SIDEBAR_COLLAPSIBLE_GROUP_ACTION_OPEN_CLASS_NAME,
	SidebarCollapsibleGroup,
} from "@/components/nav/sidebar-collapsible-group";
import { getNoteDisplayTitle } from "@/lib/note-title";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { SidebarNoteRow } from "./sidebar-note-row";
import { SidebarSortMenu } from "./sidebar-sort-menu";
import {
	getSidebarSortOptions,
	SIDEBAR_HEADER_ACTION_ROW_CLASS_NAME,
	type SidebarSortValue,
} from "./sidebar-sort-options";

const MAX_VISIBLE_NOTES = 5;
const SIDEBAR_NOTE_SKELETON_IDS = [
	"sidebar-note-skeleton-1",
	"sidebar-note-skeleton-2",
	"sidebar-note-skeleton-3",
	"sidebar-note-skeleton-4",
] as const;

type NoteListSort = SidebarSortValue;

function NavNotesActions({
	filtersOpen,
	showFewer,
	onCreateNote,
	onFiltersOpenChange,
	onShowFewer,
	onSortChange,
	sortOptions,
	className,
	...divProps
}: {
	filtersOpen: boolean;
	showFewer: boolean;
	onCreateNote: () => void;
	onFiltersOpenChange: (open: boolean) => void;
	onShowFewer: () => void;
	onSortChange: (sort: NoteListSort) => void;
	sortOptions: ReturnType<typeof getSidebarSortOptions>;
} & React.ComponentProps<"div">) {
	return (
		<div {...divProps} className={cn("flex items-center gap-0.5", className)}>
			{showFewer ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label="Show fewer notes"
							onClick={onShowFewer}
						>
							<ChevronsUp />
						</button>
					</TooltipTrigger>
					<TooltipContent
						side="bottom"
						align="center"
						className="pointer-events-none select-none"
					>
						Show less
					</TooltipContent>
				</Tooltip>
			) : null}
			<SidebarSortMenu
				label="Sort notes"
				open={filtersOpen}
				options={sortOptions}
				onOpenChange={onFiltersOpenChange}
				onSortChange={onSortChange}
			/>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label="Add note"
						className="cursor-pointer"
						onClick={onCreateNote}
					>
						<Plus />
					</button>
				</TooltipTrigger>
				<TooltipContent
					side="bottom"
					align="center"
					className="pointer-events-none select-none"
				>
					Add note
				</TooltipContent>
			</Tooltip>
		</div>
	);
}

function NavNotesContent({
	catalog,
	currentNoteId,
	currentNoteTitle,
	notes,
	recordingNoteId,
	visibleNoteSource,
	visibleNotes,
	onLoadMoreNotes,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
	onPrefetchNote,
	onShowAllNotesChange,
}: {
	catalog: {
		hasMoreLoadedNotes: boolean;
		hasMoreNotes: boolean;
		isLoadingMoreNotes: boolean;
		showAllNotes: boolean;
	};
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	notes: Array<Doc<"notes">> | undefined;
	recordingNoteId: Id<"notes"> | null;
	visibleNoteSource: Array<Doc<"notes">>;
	visibleNotes: Array<Doc<"notes">>;
	onLoadMoreNotes: () => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
	onPrefetchNote: (noteId: Id<"notes">) => void;
	onShowAllNotesChange: (showAll: boolean) => void;
}) {
	if (notes === undefined) {
		return <NavNotesSkeleton />;
	}

	const handleMoreClick = () => {
		if (!catalog.showAllNotes && catalog.hasMoreLoadedNotes) {
			onShowAllNotesChange(true);
			return;
		}
		if (catalog.hasMoreNotes) {
			onLoadMoreNotes();
			return;
		}
		onShowAllNotesChange(false);
	};
	const moreLabel = catalog.isLoadingMoreNotes
		? "Loading..."
		: catalog.showAllNotes && !catalog.hasMoreNotes
			? "Show less"
			: "Show more";

	return (
		<>
			{visibleNoteSource.length === 0 ? (
				<div className="px-2 text-xs text-muted-foreground/50">
					{notes.length > 0 ? "All notes are in projects" : "No notes yet"}
				</div>
			) : null}
			<SidebarNotesList
				notes={visibleNotes}
				currentNoteId={currentNoteId}
				currentNoteTitle={currentNoteTitle}
				recordingNoteId={recordingNoteId}
				onPrefetchNote={onPrefetchNote}
				onNoteSelect={onNoteSelect}
				onNoteTitleChange={onNoteTitleChange}
				onNoteTrashed={onNoteTrashed}
			/>
			{catalog.hasMoreLoadedNotes || catalog.hasMoreNotes ? (
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							className="text-sidebar-foreground/70 hover:bg-transparent hover:text-inherit"
							disabled={catalog.isLoadingMoreNotes}
							onClick={handleMoreClick}
						>
							<MoreHorizontal />
							<span className="text-xs">{moreLabel}</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			) : null}
		</>
	);
}

export function NavNotes({
	notes,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId = null,
	onPrefetchNote,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
	onCreateNote,
	hasMoreNotes: hasMoreCatalogNotes,
	isLoadingMoreNotes,
	onLoadMoreNotes,
}: {
	notes: Array<Doc<"notes">> | undefined;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId?: Id<"notes"> | null;
	onPrefetchNote: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
	onCreateNote: () => void;
	hasMoreNotes: boolean;
	isLoadingMoreNotes: boolean;
	onLoadMoreNotes: () => void;
}) {
	const [filtersOpen, setFiltersOpen] = React.useState(false);
	const [sortBy, setSortBy] = React.useState<NoteListSort>("updated");
	const visibleNoteSource = React.useMemo(
		() =>
			sortNotes(
				(notes ?? []).filter((note) => !note.projectId),
				sortBy,
			),
		[notes, sortBy],
	);
	const sortOptions = getSidebarSortOptions(sortBy);
	const [showAllNotes, setShowAllNotes] = React.useState(false);
	const hasMoreLoadedNotes = visibleNoteSource.length > MAX_VISIBLE_NOTES;
	const visibleNotes = showAllNotes
		? visibleNoteSource
		: visibleNoteSource.slice(0, MAX_VISIBLE_NOTES);

	return (
		<SidebarCollapsibleGroup
			title="Notes"
			className="group-data-[collapsible=icon]:hidden"
			storageKey="notes"
			actionClassName={`${SIDEBAR_COLLAPSIBLE_GROUP_ACTION_CLASS_NAME} ${SIDEBAR_HEADER_ACTION_ROW_CLASS_NAME} ${filtersOpen ? SIDEBAR_COLLAPSIBLE_GROUP_ACTION_OPEN_CLASS_NAME : ""}`}
			actions={
				<NavNotesActions
					filtersOpen={filtersOpen}
					showFewer={showAllNotes && hasMoreLoadedNotes}
					onCreateNote={onCreateNote}
					onFiltersOpenChange={setFiltersOpen}
					onShowFewer={() => setShowAllNotes(false)}
					onSortChange={setSortBy}
					sortOptions={sortOptions}
				/>
			}
		>
			<NavNotesContent
				catalog={{
					hasMoreLoadedNotes,
					hasMoreNotes: hasMoreCatalogNotes,
					isLoadingMoreNotes,
					showAllNotes,
				}}
				currentNoteId={currentNoteId}
				currentNoteTitle={currentNoteTitle}
				notes={notes}
				recordingNoteId={recordingNoteId}
				visibleNoteSource={visibleNoteSource}
				visibleNotes={visibleNotes}
				onLoadMoreNotes={onLoadMoreNotes}
				onNoteSelect={onNoteSelect}
				onNoteTitleChange={onNoteTitleChange}
				onNoteTrashed={onNoteTrashed}
				onPrefetchNote={onPrefetchNote}
				onShowAllNotesChange={setShowAllNotes}
			/>
		</SidebarCollapsibleGroup>
	);
}

function sortNotes(notes: Array<Doc<"notes">>, sortBy: NoteListSort) {
	return notes.slice().sort((left, right) => {
		if (sortBy === "created") {
			return compareNotesByTimestamp(
				left.createdAt,
				right.createdAt,
				left,
				right,
			);
		}

		if (sortBy === "updated") {
			return compareNotesByTimestamp(
				left.updatedAt,
				right.updatedAt,
				left,
				right,
			);
		}

		return compareNotesByName(left, right);
	});
}

function compareNotesByTimestamp(
	leftTimestamp: number,
	rightTimestamp: number,
	leftNote: Doc<"notes">,
	rightNote: Doc<"notes">,
) {
	if (rightTimestamp !== leftTimestamp) {
		return rightTimestamp - leftTimestamp;
	}

	return compareNotesByName(leftNote, rightNote);
}

function compareNotesByName(leftNote: Doc<"notes">, rightNote: Doc<"notes">) {
	const normalizedComparison = getNoteDisplayTitle(
		leftNote.title,
	).localeCompare(getNoteDisplayTitle(rightNote.title));
	if (normalizedComparison !== 0) {
		return normalizedComparison;
	}

	return leftNote._creationTime - rightNote._creationTime;
}

function SidebarNotesList({
	notes,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId,
	onPrefetchNote,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
}: {
	notes: Array<Doc<"notes">>;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId: Id<"notes"> | null;
	onPrefetchNote: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
}) {
	return (
		<SidebarMenu>
			{notes.map((note) => (
				<SidebarNoteRow
					key={note._id}
					note={note}
					currentNoteId={currentNoteId}
					currentNoteTitle={currentNoteTitle}
					recordingNoteId={recordingNoteId}
					onPrefetchNote={onPrefetchNote}
					onNoteSelect={onNoteSelect}
					onNoteTitleChange={onNoteTitleChange}
					onNoteTrashed={onNoteTrashed}
				/>
			))}
		</SidebarMenu>
	);
}

function NavNotesSkeleton() {
	return (
		<div className="px-2">
			<div className="space-y-2">
				{SIDEBAR_NOTE_SKELETON_IDS.map((id) => (
					<div key={id} className="flex items-center gap-2 rounded-md py-1">
						<Skeleton className="size-4 rounded-sm" />
						<Skeleton className="h-4 flex-1" />
					</div>
				))}
			</div>
		</div>
	);
}
