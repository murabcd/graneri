import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import {
	Collapsible,
	CollapsibleContent,
} from "@workspace/ui/components/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Popover, PopoverAnchor } from "@workspace/ui/components/popover";
import {
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@workspace/ui/components/sidebar";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import {
	Archive,
	ArrowUpAZ,
	ChevronRight,
	ChevronsDown,
	ChevronsUp,
	Clock3,
	HandGrab,
	MoreHorizontal,
	Pencil,
	Plus,
	PlusCircle,
	Star,
	StarOff,
	Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import { HoverScrollTitle } from "@/components/hover-scroll-title";
import { RenamePopoverContent } from "@/components/navigation/rename-popover";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import {
	ProjectIcon,
	ProjectIdentityInput,
} from "@/components/projects/project-appearance-picker";
import {
	type SidebarProjectIdentityEditorController,
	useSidebarProjectIdentityEditor,
} from "@/components/projects/use-project-identity-editor";
import { logError } from "@/lib/logger";
import {
	insertOptimisticNote,
	mapOptimisticNoteCatalogs,
	removeOptimisticNotes,
} from "@/lib/optimistic-note-catalog";
import { archiveNoteChats } from "@/lib/optimistic-note-chats";
import { optimisticUpdateProjectList } from "@/lib/optimistic-projects";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import {
	buildProjectEntries,
	initialNavProjectsState,
	navProjectsReducer,
	type ProjectListSort,
	type ProjectWithNotes,
	sortProjectEntries,
} from "./nav-projects-state";
import {
	SIDEBAR_COLLAPSIBLE_GROUP_ACTION_CLASS_NAME,
	SIDEBAR_COLLAPSIBLE_GROUP_ACTION_OPEN_CLASS_NAME,
	SidebarCollapsibleGroup,
} from "./sidebar-collapsible-group";
import { SidebarNoteRow } from "./sidebar-note-row";
import { SidebarSortMenu } from "./sidebar-sort-menu";
import {
	SIDEBAR_HEADER_ACTION_ROW_CLASS_NAME,
	type SidebarSortOption,
} from "./sidebar-sort-options";
import { SidebarSortableList } from "./sidebar-sortable-list";
import { resolveSidebarSortableItems } from "./sidebar-sortable-utils";
import {
	type SidebarSortableBindings,
	useSidebarSortableBindings,
} from "./use-sidebar-sortable-bindings";

const SIDEBAR_PROJECT_SKELETON_IDS = [
	"sidebar-project-skeleton-1",
	"sidebar-project-skeleton-2",
] as const;
const MAX_VISIBLE_PROJECT_NOTES = 5;

const getProjectSortOptions = (
	selectedValue: ProjectListSort,
): Array<SidebarSortOption<ProjectListSort>> => [
	{
		icon: HandGrab,
		label: "Custom",
		selected: selectedValue === "custom",
		value: "custom",
	},
	{
		icon: ArrowUpAZ,
		label: "Name",
		selected: selectedValue === "name",
		value: "name",
	},
	{
		icon: PlusCircle,
		label: "Created",
		selected: selectedValue === "created",
		value: "created",
	},
	{
		icon: Clock3,
		label: "Updated",
		selected: selectedValue === "updated",
		value: "updated",
	},
];

type NavProjectsProps = {
	autoRevealActiveNoteProject?: boolean;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	notes: Array<Doc<"notes">> | undefined;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onProjectSelect: (projectId: Id<"projects">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
	onPrefetchNote: (noteId: Id<"notes">) => void;
	onCreateNoteInsideProject: (projectId: Id<"projects">) => void;
	projects: Array<Doc<"projects">> | undefined;
	recordingNoteId?: Id<"notes"> | null;
	workspaceId: Id<"workspaces"> | null;
};

type ProjectSidebarItemProps = {
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	notes: Array<Doc<"notes">>;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onProjectSelect: (projectId: Id<"projects">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
	onOpenChange: (open: boolean) => void;
	onPrefetchNote: (noteId: Id<"notes">) => void;
	open: boolean;
	project: Doc<"projects">;
	projectRowActions: React.ReactNode;
	recordingNoteId: Id<"notes"> | null;
	sortable?: SidebarSortableBindings;
	workspaceId: Id<"workspaces"> | null;
};

type ProjectItemState = {
	confirmOpen: boolean;
	menuOpen: boolean;
	moveNotesConfirmOpen: boolean;
};

type ProjectItemAction =
	| { type: "setConfirmOpen"; value: boolean }
	| { type: "setMenuOpen"; value: boolean }
	| { type: "setMoveNotesConfirmOpen"; value: boolean };

const initialProjectItemState: ProjectItemState = {
	confirmOpen: false,
	menuOpen: false,
	moveNotesConfirmOpen: false,
};

function projectItemReducer(
	state: ProjectItemState,
	action: ProjectItemAction,
): ProjectItemState {
	switch (action.type) {
		case "setConfirmOpen":
			return {
				...state,
				confirmOpen: action.value,
			};
		case "setMenuOpen":
			return {
				...state,
				menuOpen: action.value,
			};
		case "setMoveNotesConfirmOpen":
			return {
				...state,
				moveNotesConfirmOpen: action.value,
			};
		default:
			return state;
	}
}

export function NavProjects({
	projects,
	notes,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId = null,
	autoRevealActiveNoteProject = true,
	workspaceId,
	onPrefetchNote,
	onNoteSelect,
	onProjectSelect,
	onNoteTitleChange,
	onNoteTrashed,
	onCreateNoteInsideProject,
}: NavProjectsProps) {
	const [state, dispatch] = React.useReducer(
		navProjectsReducer,
		initialNavProjectsState,
	);
	const {
		collapsedProjectIds,
		createError,
		createOpen,
		expandedProjectIds,
		filtersOpen,
		name,
		sortBy,
	} = state;
	const [isCreatingProject, startProjectCreation] = React.useTransition();
	const createProject = useMutation(api.projects.create);
	const reorderProjects = useMutation(
		api.projects.reorder,
	).withOptimisticUpdate((localStore, args) => {
		optimisticUpdateProjectList(localStore, args.workspaceId, (projects) => {
			const projectsById = new Map(
				projects.map((project) => [project._id, project]),
			);
			return args.projectIds.flatMap((projectId, index) => {
				const project = projectsById.get(projectId);
				return project
					? [
							{
								...project,
								sortOrder: index,
							},
						]
					: [];
			});
		});
	});
	const projectEntries = React.useMemo(
		() => buildProjectEntries(projects ?? [], notes ?? []),
		[notes, projects],
	);
	const visibleProjectEntries = React.useMemo(
		() => sortProjectEntries(projectEntries, sortBy),
		[projectEntries, sortBy],
	);
	const visibleProjectIds = React.useMemo(
		() => visibleProjectEntries.map(({ project }) => project._id),
		[visibleProjectEntries],
	);
	const expandedProjectIdSet = React.useMemo(
		() => new Set(expandedProjectIds),
		[expandedProjectIds],
	);
	const projectTreeToggleTargetCount = React.useMemo(
		() => new Set([...collapsedProjectIds, ...expandedProjectIds]).size,
		[collapsedProjectIds, expandedProjectIds],
	);
	const expandedProjectCount = expandedProjectIds.length;
	const showProjectTreeToggle = projectTreeToggleTargetCount > 1;
	const isProjectTreeCollapsed =
		projectTreeToggleTargetCount > 1 &&
		expandedProjectCount < projectTreeToggleTargetCount;
	const isPending = projects === undefined || notes === undefined;
	const canReorderProjects =
		sortBy === "custom" && !isPending && visibleProjectEntries.length > 1;

	React.useEffect(() => {
		dispatch({ type: "reconcileProjectIds", value: visibleProjectIds });
	}, [visibleProjectIds]);

	React.useEffect(() => {
		if (!currentNoteId || !autoRevealActiveNoteProject) {
			return;
		}

		const activeProject = visibleProjectEntries.find(({ notes }) =>
			notes.some((note) => note._id === currentNoteId),
		);
		if (!activeProject) {
			return;
		}

		dispatch({
			type: "setProjectOpen",
			id: activeProject.project._id,
			value: true,
			preserveCollapsedProjects: true,
		});
	}, [autoRevealActiveNoteProject, currentNoteId, visibleProjectEntries]);

	const handleCreateProject = React.useCallback(() => {
		if (!workspaceId || isCreatingProject || name.trim().length < 1) {
			return;
		}

		startProjectCreation(async () => {
			try {
				dispatch({ type: "setCreateError", value: null });
				await createProject({
					workspaceId,
					name,
				});
				dispatch({ type: "setCreateOpen", value: false });
			} catch (error) {
				dispatch({
					type: "setCreateError",
					value:
						error instanceof Error
							? error.message
							: "Failed to create project.",
				});
			}
		});
	}, [createProject, isCreatingProject, name, workspaceId]);

	const handleProjectReorder = React.useCallback(
		(projectIds: Array<Id<"projects">>) => {
			if (!workspaceId) {
				return;
			}

			void reorderProjects({
				workspaceId,
				projectIds,
			}).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to reorder projects",
				});
				toast.error("Failed to reorder projects");
			});
		},
		[reorderProjects, workspaceId],
	);

	return (
		<>
			<SidebarCollapsibleGroup
				title="Projects"
				className="group-data-[collapsible=icon]:hidden"
				storageKey="projects"
				actionClassName={`${SIDEBAR_COLLAPSIBLE_GROUP_ACTION_CLASS_NAME} ${SIDEBAR_HEADER_ACTION_ROW_CLASS_NAME} ${filtersOpen ? SIDEBAR_COLLAPSIBLE_GROUP_ACTION_OPEN_CLASS_NAME : ""}`}
				actions={
					<div className="flex items-center gap-0.5">
						{showProjectTreeToggle ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										aria-label={
											isProjectTreeCollapsed
												? "Reopen previous"
												: "Collapse all"
										}
										onClick={() =>
											dispatch({
												type: isProjectTreeCollapsed
													? "expandCollapsedProjects"
													: "collapseExpandedProjects",
											})
										}
									>
										{isProjectTreeCollapsed ? <ChevronsDown /> : <ChevronsUp />}
									</button>
								</TooltipTrigger>
								<TooltipContent
									side="bottom"
									align="center"
									className="pointer-events-none select-none"
								>
									{isProjectTreeCollapsed ? "Reopen previous" : "Collapse all"}
								</TooltipContent>
							</Tooltip>
						) : null}
						<ProjectsFilterMenu
							open={filtersOpen}
							sortBy={sortBy}
							onOpenChange={(open) =>
								dispatch({ type: "setFiltersOpen", value: open })
							}
							onSortChange={(value) => dispatch({ type: "setSortBy", value })}
						/>
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									aria-label="Add project"
									onClick={() =>
										dispatch({ type: "setCreateOpen", value: true })
									}
								>
									<Plus />
								</button>
							</TooltipTrigger>
							<TooltipContent
								side="bottom"
								align="center"
								className="pointer-events-none select-none"
							>
								Add project
							</TooltipContent>
						</Tooltip>
					</div>
				}
			>
				{isPending ? <NavProjectsSkeleton /> : null}
				{!isPending && visibleProjectEntries.length === 0 ? (
					<div className="px-2 text-xs text-muted-foreground/50">
						No projects yet
					</div>
				) : null}
				{isPending ? null : (
					<ProjectSidebarList
						canReorder={canReorderProjects}
						currentNoteId={currentNoteId}
						currentNoteTitle={currentNoteTitle}
						entries={visibleProjectEntries}
						expandedProjectIdSet={expandedProjectIdSet}
						onNoteSelect={onNoteSelect}
						onNoteTitleChange={onNoteTitleChange}
						onNoteTrashed={onNoteTrashed}
						onCreateNoteInsideProject={onCreateNoteInsideProject}
						onOpenChange={(projectId, open) =>
							dispatch({
								type: "setProjectOpen",
								id: projectId,
								value: open,
							})
						}
						onPrefetchNote={onPrefetchNote}
						onReorder={handleProjectReorder}
						recordingNoteId={recordingNoteId}
						visibleProjectIds={visibleProjectIds}
						workspaceId={workspaceId}
						onProjectSelect={onProjectSelect}
					/>
				)}
			</SidebarCollapsibleGroup>
			<CreateProjectDialog
				open={createOpen}
				onOpenChange={(open) =>
					dispatch({ type: "setCreateOpen", value: open })
				}
				name={name}
				error={createError}
				isCreating={isCreatingProject}
				onNameChange={(value) => dispatch({ type: "setName", value })}
				onSubmit={handleCreateProject}
			/>
		</>
	);
}

function ProjectsFilterMenu({
	open,
	sortBy,
	onOpenChange,
	onSortChange,
}: {
	open: boolean;
	sortBy: ProjectListSort;
	onOpenChange: (open: boolean) => void;
	onSortChange: (value: ProjectListSort) => void;
}) {
	return (
		<SidebarSortMenu
			label="Sort projects"
			open={open}
			options={getProjectSortOptions(sortBy)}
			onOpenChange={onOpenChange}
			onSortChange={onSortChange}
		/>
	);
}

function ProjectSidebarList({
	canReorder,
	currentNoteId,
	currentNoteTitle,
	entries,
	expandedProjectIdSet,
	onNoteSelect,
	onProjectSelect,
	onNoteTitleChange,
	onNoteTrashed,
	onCreateNoteInsideProject,
	onOpenChange,
	onPrefetchNote,
	onReorder,
	recordingNoteId,
	visibleProjectIds,
	workspaceId,
}: {
	canReorder: boolean;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	entries: Array<ProjectWithNotes>;
	expandedProjectIdSet: Set<Id<"projects">>;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onProjectSelect: (projectId: Id<"projects">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
	onCreateNoteInsideProject: (projectId: Id<"projects">) => void;
	onOpenChange: (projectId: Id<"projects">, open: boolean) => void;
	onPrefetchNote: (noteId: Id<"notes">) => void;
	onReorder: (projectIds: Array<Id<"projects">>) => void;
	recordingNoteId: Id<"notes"> | null;
	visibleProjectIds: Array<Id<"projects">>;
	workspaceId: Id<"workspaces"> | null;
}) {
	const projectIdsBySortableId = React.useMemo(
		() => new Map(visibleProjectIds.map((id) => [String(id), id])),
		[visibleProjectIds],
	);
	const sortableIds = React.useMemo(
		() => visibleProjectIds.map((id) => String(id)),
		[visibleProjectIds],
	);
	const handleReorder = React.useCallback(
		(ids: Array<string>) => {
			const projectIds = resolveSidebarSortableItems(
				ids,
				projectIdsBySortableId,
			);
			if (!projectIds) {
				toast.error("Failed to reorder projects");
				return;
			}

			onReorder(projectIds);
		},
		[onReorder, projectIdsBySortableId],
	);
	const list = (
		<SidebarMenu>
			{entries.map(({ project, notes: projectNotes }) => {
				const Item = canReorder
					? SortableProjectSidebarItem
					: ProjectSidebarItem;

				return (
					<Item
						key={project._id}
						project={project}
						notes={projectNotes}
						open={expandedProjectIdSet.has(project._id)}
						workspaceId={workspaceId}
						currentNoteId={currentNoteId}
						currentNoteTitle={currentNoteTitle}
						recordingNoteId={recordingNoteId}
						onPrefetchNote={onPrefetchNote}
						onNoteSelect={onNoteSelect}
						onProjectSelect={onProjectSelect}
						onNoteTitleChange={onNoteTitleChange}
						onNoteTrashed={onNoteTrashed}
						onOpenChange={(open) => onOpenChange(project._id, open)}
						projectRowActions={
							<ProjectAddNoteButton
								projectName={project.name}
								workspaceId={workspaceId}
								onCreateNoteInsideProject={() =>
									onCreateNoteInsideProject(project._id)
								}
							/>
						}
					/>
				);
			})}
		</SidebarMenu>
	);

	return canReorder ? (
		<SidebarSortableList ids={sortableIds} onReorder={handleReorder}>
			{list}
		</SidebarSortableList>
	) : (
		list
	);
}

export function ProjectSidebarItem({
	project,
	notes,
	open,
	workspaceId,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId,
	onPrefetchNote,
	onNoteSelect,
	onProjectSelect,
	onNoteTitleChange,
	onNoteTrashed,
	onOpenChange,
	projectRowActions,
	sortable,
}: ProjectSidebarItemProps) {
	const hasNotes = notes.length > 0;
	const [state, dispatch] = React.useReducer(
		projectItemReducer,
		initialProjectItemState,
	);
	const identityEditor = useSidebarProjectIdentityEditor({
		project,
		workspaceId,
	});
	const [isRemoving, setIsRemoving] = React.useState(false);
	const [isMovingNotesToTrash, setIsMovingNotesToTrash] = React.useState(false);
	const isUpdatingStarRef = React.useRef(false);
	const removeProject = useMutation(api.projects.remove).withOptimisticUpdate(
		(localStore, args) => {
			optimisticUpdateProjectList(localStore, args.workspaceId, (projects) =>
				projects.filter((entry) => entry._id !== args.id),
			);
			optimisticClearProjectFromNotes(localStore, args.workspaceId, args.id);
		},
	);
	const toggleProjectStar = useMutation(
		api.projects.toggleStar,
	).withOptimisticUpdate((localStore, args) => {
		optimisticUpdateProjectList(localStore, args.workspaceId, (projects) =>
			projects.map((entry) =>
				entry._id === args.id
					? {
							...entry,
							isStarred: !entry.isStarred,
							updatedAt: Date.now(),
						}
					: entry,
			),
		);
	});
	const moveProjectNotesToTrash = useMutation(
		api.projects.moveNotesToTrash,
	).withOptimisticUpdate((localStore, args) => {
		optimisticMoveProjectNotesToTrash(localStore, args.workspaceId, args.id);
	});

	const handleToggleStar = React.useCallback(async () => {
		if (!workspaceId || isUpdatingStarRef.current) {
			return;
		}

		isUpdatingStarRef.current = true;

		try {
			const result = await toggleProjectStar({
				workspaceId,
				id: project._id,
			});
			toast.success(result.isStarred ? "Project starred" : "Project unstarred");
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to update project star",
			});
			toast.error("Failed to update project");
		} finally {
			isUpdatingStarRef.current = false;
		}
	}, [project._id, toggleProjectStar, workspaceId]);

	const handleDeleteProject = React.useCallback(async () => {
		if (!workspaceId || isRemoving) {
			return;
		}

		setIsRemoving(true);

		try {
			await removeProject({
				workspaceId,
				id: project._id,
			});
			dispatch({ type: "setConfirmOpen", value: false });
			toast.success("Project deleted");
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to delete project",
			});
			toast.error("Failed to delete project");
		} finally {
			setIsRemoving(false);
		}
	}, [isRemoving, project._id, removeProject, workspaceId]);

	const handleMoveNotesToTrash = React.useCallback(async () => {
		if (!workspaceId || isMovingNotesToTrash) {
			return;
		}

		setIsMovingNotesToTrash(true);

		try {
			const result = await moveProjectNotesToTrash({
				workspaceId,
				id: project._id,
			});
			dispatch({ type: "setMoveNotesConfirmOpen", value: false });
			toast.success(
				result.movedCount === 1
					? "1 note moved to trash"
					: `${result.movedCount} notes moved to trash`,
			);
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to move project notes to trash",
			});
			toast.error("Failed to move notes to trash");
		} finally {
			setIsMovingNotesToTrash(false);
		}
	}, [isMovingNotesToTrash, moveProjectNotesToTrash, project._id, workspaceId]);

	return (
		<ProjectSidebarItemView
			currentNoteId={currentNoteId}
			currentNoteTitle={currentNoteTitle}
			dispatch={dispatch}
			hasNotes={hasNotes}
			isMovingNotesToTrash={isMovingNotesToTrash}
			isRemoving={isRemoving}
			notes={notes}
			onDeleteProject={handleDeleteProject}
			onMoveNotesToTrash={handleMoveNotesToTrash}
			onNoteSelect={onNoteSelect}
			onNoteTitleChange={onNoteTitleChange}
			onNoteTrashed={onNoteTrashed}
			onOpenChange={onOpenChange}
			onPrefetchNote={onPrefetchNote}
			onProjectSelect={onProjectSelect}
			onToggleStar={handleToggleStar}
			open={open}
			project={project}
			projectRowActions={projectRowActions}
			recordingNoteId={recordingNoteId}
			identityEditor={identityEditor}
			sortable={sortable}
			state={state}
			workspaceId={workspaceId}
		/>
	);
}

function ProjectSidebarItemView({
	currentNoteId,
	currentNoteTitle,
	dispatch,
	hasNotes,
	isMovingNotesToTrash,
	isRemoving,
	notes,
	onDeleteProject,
	onMoveNotesToTrash,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
	onOpenChange,
	onPrefetchNote,
	onProjectSelect,
	onToggleStar,
	open,
	project,
	projectRowActions,
	recordingNoteId,
	identityEditor,
	sortable,
	state,
	workspaceId,
}: ProjectSidebarItemProps & {
	dispatch: React.Dispatch<ProjectItemAction>;
	hasNotes: boolean;
	identityEditor: SidebarProjectIdentityEditorController;
	isMovingNotesToTrash: boolean;
	isRemoving: boolean;
	onDeleteProject: () => Promise<void>;
	onMoveNotesToTrash: () => Promise<void>;
	onToggleStar: () => Promise<void>;
	state: ProjectItemState;
}) {
	return (
		<>
			<Collapsible asChild open={open} onOpenChange={onOpenChange}>
				<SidebarMenuItem
					ref={sortable?.ref}
					style={sortable?.style}
					className={
						sortable?.isDragging
							? "group/project-item group/collapsible relative z-10 opacity-80"
							: "group/project-item group/collapsible"
					}
				>
					<ProjectSidebarRow
						identityEditor={identityEditor}
						projectName={project.name}
						hasNotes={hasNotes}
						isStarred={project.isStarred ?? false}
						workspaceId={workspaceId}
						isOpen={open}
						menuOpen={state.menuOpen}
						sortableButtonProps={sortable?.buttonProps}
						onMenuOpenChange={(nextOpen) =>
							dispatch({ type: "setMenuOpen", value: nextOpen })
						}
						onOpen={() => onOpenChange(true)}
						onToggleOpen={() => onOpenChange(!open)}
						onSelectProject={() => onProjectSelect(project._id)}
						onStartRename={() => {
							identityEditor.prepareMenuOpen();
							dispatch({ type: "setMenuOpen", value: false });
						}}
						onToggleStar={onToggleStar}
						onMoveNotesToTrash={() => {
							dispatch({ type: "setMenuOpen", value: false });
							dispatch({ type: "setMoveNotesConfirmOpen", value: true });
						}}
						onDeleteSelect={() => {
							dispatch({ type: "setMenuOpen", value: false });
							dispatch({ type: "setConfirmOpen", value: true });
						}}
						rowActions={projectRowActions}
					/>
					<ProjectSidebarContent
						hasNotes={hasNotes}
						notes={notes}
						currentNoteId={currentNoteId}
						currentNoteTitle={currentNoteTitle}
						recordingNoteId={recordingNoteId}
						onPrefetchNote={onPrefetchNote}
						onNoteSelect={onNoteSelect}
						onNoteTitleChange={onNoteTitleChange}
						onNoteTrashed={onNoteTrashed}
					/>
				</SidebarMenuItem>
			</Collapsible>
			<ProjectSidebarItemDialogs
				open={state.confirmOpen}
				isRemoving={isRemoving}
				moveNotesOpen={state.moveNotesConfirmOpen}
				isMoving={isMovingNotesToTrash}
				noteCount={notes.length}
				onDeleteOpenChange={(nextOpen) =>
					dispatch({ type: "setConfirmOpen", value: nextOpen })
				}
				onMoveNotesOpenChange={(nextOpen) =>
					dispatch({ type: "setMoveNotesConfirmOpen", value: nextOpen })
				}
				onDeleteConfirm={onDeleteProject}
				onMoveNotesConfirm={onMoveNotesToTrash}
			/>
		</>
	);
}

function SortableProjectSidebarItem(
	props: Omit<React.ComponentProps<typeof ProjectSidebarItem>, "sortable">,
) {
	const sortable = useSidebarSortableBindings(String(props.project._id));

	return <ProjectSidebarItem {...props} sortable={sortable} />;
}

function ProjectSidebarItemDialogs({
	open,
	isRemoving,
	moveNotesOpen,
	isMoving,
	noteCount,
	onDeleteOpenChange,
	onMoveNotesOpenChange,
	onDeleteConfirm,
	onMoveNotesConfirm,
}: {
	open: boolean;
	isRemoving: boolean;
	moveNotesOpen: boolean;
	isMoving: boolean;
	noteCount: number;
	onDeleteOpenChange: (open: boolean) => void;
	onMoveNotesOpenChange: (open: boolean) => void;
	onDeleteConfirm: () => void;
	onMoveNotesConfirm: () => void;
}) {
	return (
		<>
			<ProjectDeleteDialog
				open={open}
				isRemoving={isRemoving}
				onOpenChange={onDeleteOpenChange}
				onConfirm={onDeleteConfirm}
			/>
			<ProjectMoveNotesToTrashDialog
				open={moveNotesOpen}
				isMoving={isMoving}
				noteCount={noteCount}
				onOpenChange={onMoveNotesOpenChange}
				onConfirm={onMoveNotesConfirm}
			/>
		</>
	);
}

function ProjectSidebarRow({
	identityEditor,
	projectName,
	hasNotes,
	isStarred,
	workspaceId,
	isOpen,
	menuOpen,
	sortableButtonProps,
	onMenuOpenChange,
	onOpen,
	onToggleOpen,
	onSelectProject,
	onStartRename,
	onToggleStar,
	onMoveNotesToTrash,
	onDeleteSelect,
	rowActions,
}: {
	identityEditor: SidebarProjectIdentityEditorController;
	projectName: string;
	hasNotes: boolean;
	isStarred: boolean;
	workspaceId: Id<"workspaces"> | null;
	isOpen: boolean;
	menuOpen: boolean;
	sortableButtonProps?: React.HTMLAttributes<HTMLButtonElement>;
	onMenuOpenChange: (open: boolean) => void;
	onOpen: () => void;
	onToggleOpen: () => void;
	onSelectProject: () => void;
	onStartRename: () => void;
	onToggleStar: () => void;
	onMoveNotesToTrash: () => void;
	onDeleteSelect: () => void;
	rowActions: React.ReactNode;
}) {
	return (
		<Popover
			modal
			open={identityEditor.open}
			onOpenChange={identityEditor.onOpenChange}
		>
			<PopoverAnchor asChild>
				<div className="group/project-row relative" data-hover-scroll-title-row>
					<SidebarMenuButton
						className="group-has-data-[sidebar=menu-action]/project-row:pr-2 group-hover/project-row:pr-14! group-has-data-[state=open]/project-row:pr-14!"
						aria-expanded={isOpen}
						onClick={(event) => {
							if (event.defaultPrevented) {
								return;
							}

							onOpen();
							onSelectProject();
						}}
						{...sortableButtonProps}
					>
						<span
							className="relative size-4 shrink-0"
							aria-hidden="true"
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								onToggleOpen();
							}}
						>
							<span className="absolute inset-0 flex items-center justify-center opacity-100 transition-opacity group-hover/menu-button:opacity-0">
								<ProjectIcon
									{...identityEditor.previewAppearance}
									mutedDefault
									open={isOpen}
								/>
							</span>
							<ChevronRight
								className={
									isOpen
										? "absolute inset-0 m-auto size-4 rotate-90 text-sidebar-foreground/50 opacity-0 transition-[opacity,transform] group-hover/menu-button:opacity-100"
										: "absolute inset-0 m-auto size-4 text-sidebar-foreground/50 opacity-0 transition-[opacity,transform] group-hover/menu-button:opacity-100"
								}
							/>
						</span>
						<HoverScrollTitle keepFadeOnHover>{projectName}</HoverScrollTitle>
					</SidebarMenuButton>
					<ProjectActionsMenu
						projectName={projectName}
						hasNotes={hasNotes}
						isStarred={isStarred}
						workspaceId={workspaceId}
						menuOpen={menuOpen}
						preventMenuCloseAutoFocusRef={
							identityEditor.preventMenuCloseAutoFocusRef
						}
						onMenuCloseAutoFocus={identityEditor.completeMenuClose}
						onMenuOpenChange={onMenuOpenChange}
						onStartRename={onStartRename}
						onToggleStar={onToggleStar}
						onMoveNotesToTrash={onMoveNotesToTrash}
						onDeleteSelect={onDeleteSelect}
					/>
					{rowActions}
				</div>
			</PopoverAnchor>
			<RenamePopoverContent
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					requestAnimationFrame(() => {
						const input = identityEditor.inputRef.current;
						if (!input) {
							return;
						}

						input.focus();
						input.setSelectionRange(0, input.value.length);
					});
				}}
			>
				<ProjectIdentityInput
					inputRef={identityEditor.inputRef}
					appearance={identityEditor.draft}
					name={identityEditor.draft.name}
					onAppearanceChange={identityEditor.setAppearance}
					onNameChange={identityEditor.setName}
					onCommit={() => {
						void identityEditor.commit();
					}}
					onCancel={identityEditor.cancel}
				/>
			</RenamePopoverContent>
		</Popover>
	);
}

function ProjectAddNoteButton({
	projectName,
	workspaceId,
	onCreateNoteInsideProject,
}: {
	projectName: string;
	workspaceId: Id<"workspaces"> | null;
	onCreateNoteInsideProject: () => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<SidebarMenuAction
					className="right-1 pointer-events-none cursor-pointer opacity-0 transition-opacity group-hover/project-row:pointer-events-auto group-hover/project-row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
					aria-label={`Add note inside ${projectName}`}
					disabled={!workspaceId}
					onPointerDown={(event) => {
						event.stopPropagation();
					}}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onCreateNoteInsideProject();
					}}
				>
					<Plus />
				</SidebarMenuAction>
			</TooltipTrigger>
			<TooltipContent side="right">Add note inside</TooltipContent>
		</Tooltip>
	);
}

function ProjectActionsMenu({
	projectName,
	hasNotes,
	isStarred,
	workspaceId,
	menuOpen,
	preventMenuCloseAutoFocusRef,
	onMenuCloseAutoFocus,
	onMenuOpenChange,
	onStartRename,
	onToggleStar,
	onMoveNotesToTrash,
	onDeleteSelect,
}: {
	projectName: string;
	hasNotes: boolean;
	isStarred: boolean;
	workspaceId: Id<"workspaces"> | null;
	menuOpen: boolean;
	preventMenuCloseAutoFocusRef: React.MutableRefObject<boolean>;
	onMenuCloseAutoFocus: () => void;
	onMenuOpenChange: (open: boolean) => void;
	onStartRename: () => void;
	onToggleStar: () => void;
	onMoveNotesToTrash: () => void;
	onDeleteSelect: () => void;
}) {
	return (
		<DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
			<DropdownMenuTrigger asChild>
				<SidebarMenuAction
					className="right-7 pointer-events-none cursor-pointer opacity-0 transition-opacity group-hover/project-row:pointer-events-auto group-hover/project-row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100"
					aria-label={`Open actions for ${projectName}`}
					onPointerDown={(event) => {
						event.stopPropagation();
					}}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
					}}
				>
					<MoreHorizontal />
				</SidebarMenuAction>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				className="w-48 rounded-lg"
				side="right"
				align="start"
				onCloseAutoFocus={(event) => {
					if (preventMenuCloseAutoFocusRef.current) {
						event.preventDefault();
						preventMenuCloseAutoFocusRef.current = false;
					}
					onMenuCloseAutoFocus();
				}}
			>
				<DropdownMenuItem disabled={!workspaceId} onClick={onStartRename}>
					<Pencil />
					Rename
				</DropdownMenuItem>
				<DropdownMenuItem disabled={!workspaceId} onClick={onToggleStar}>
					{isStarred ? <StarOff /> : <Star />}
					{isStarred ? "Unstar" : "Star"}
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={!workspaceId || !hasNotes}
					onClick={onMoveNotesToTrash}
				>
					<Archive />
					Move notes to trash
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					disabled={!workspaceId}
					onSelect={(event) => {
						event.preventDefault();
						onDeleteSelect();
					}}
				>
					<Trash2 />
					Delete
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ProjectSidebarContent({
	hasNotes,
	notes,
	currentNoteId,
	currentNoteTitle,
	recordingNoteId,
	onPrefetchNote,
	onNoteSelect,
	onNoteTitleChange,
	onNoteTrashed,
}: {
	hasNotes: boolean;
	notes: Array<Doc<"notes">>;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	recordingNoteId: Id<"notes"> | null;
	onPrefetchNote: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
}) {
	const [showAllNotes, setShowAllNotes] = React.useState(false);
	const hasMoreNotes = notes.length > MAX_VISIBLE_PROJECT_NOTES;
	const visibleNotes = showAllNotes
		? notes
		: notes.slice(0, MAX_VISIBLE_PROJECT_NOTES);

	return (
		<CollapsibleContent className="group/project-folder-content overflow-hidden">
			<div className="min-h-0 overflow-hidden">
				{hasNotes ? (
					<SidebarMenuSub className="mr-0 translate-x-0 pr-0">
						{visibleNotes.map((note) => (
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
						{hasMoreNotes ? (
							<SidebarMenuSubItem>
								<SidebarMenuSubButton
									asChild
									className="cursor-pointer text-sidebar-foreground/70 hover:bg-transparent hover:text-inherit"
								>
									<button
										type="button"
										onClick={() => setShowAllNotes((prev) => !prev)}
									>
										<MoreHorizontal />
										<span className="text-xs">
											{showAllNotes ? "Show less" : "Show more"}
										</span>
									</button>
								</SidebarMenuSubButton>
							</SidebarMenuSubItem>
						) : null}
					</SidebarMenuSub>
				) : (
					<div className="px-8 py-2 text-xs text-sidebar-foreground/50">
						No notes in project yet
					</div>
				)}
			</div>
		</CollapsibleContent>
	);
}

function ProjectDeleteDialog({
	open,
	isRemoving,
	onOpenChange,
	onConfirm,
}: {
	open: boolean;
	isRemoving: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	return (
		<DestructiveConfirmationDialog
			actionLabel="Delete"
			description="This action cannot be undone. This will delete your project and move its notes back."
			isPending={isRemoving}
			onConfirm={onConfirm}
			onOpenChange={onOpenChange}
			open={open}
			pendingActionLabel="Deleting..."
			title="Are you absolutely sure?"
		/>
	);
}

function ProjectMoveNotesToTrashDialog({
	open,
	isMoving,
	noteCount,
	onOpenChange,
	onConfirm,
}: {
	open: boolean;
	isMoving: boolean;
	noteCount: number;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Move notes to trash?</AlertDialogTitle>
					<AlertDialogDescription>
						This will move your notes to Trash. You can restore them later.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isMoving}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={onConfirm}
						disabled={isMoving || noteCount === 0}
					>
						{isMoving ? "Moving..." : "Move to trash"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function NavProjectsSkeleton() {
	return (
		<div className="px-2">
			<div className="flex flex-col gap-2">
				{SIDEBAR_PROJECT_SKELETON_IDS.map((id) => (
					<div key={id} className="flex items-center gap-2 rounded-md py-1">
						<Skeleton className="size-4 rounded-sm" />
						<Skeleton className="h-4 flex-1" />
					</div>
				))}
			</div>
		</div>
	);
}

function optimisticClearProjectFromNotes(
	localStore: OptimisticLocalStore,
	workspaceId: Id<"workspaces">,
	projectId: Id<"projects">,
) {
	const matchedNoteIds = new Set<Id<"notes">>();
	mapOptimisticNoteCatalogs(localStore, workspaceId, (note) => {
		if (note.projectId !== projectId) {
			return note;
		}

		matchedNoteIds.add(note._id);
		return {
			...note,
			projectId: undefined,
		};
	});

	for (const noteId of matchedNoteIds) {
		const activeNote = localStore.getQuery(api.notes.get, {
			workspaceId,
			id: noteId,
		});
		if (!activeNote || activeNote.projectId !== projectId) {
			continue;
		}

		localStore.setQuery(
			api.notes.get,
			{ workspaceId, id: noteId },
			{
				...activeNote,
				projectId: undefined,
			},
		);
	}

	const latestNote = localStore.getQuery(api.notes.getLatest, { workspaceId });
	if (latestNote?.projectId === projectId) {
		localStore.setQuery(
			api.notes.getLatest,
			{ workspaceId },
			{
				...latestNote,
				projectId: undefined,
			},
		);
	}
}

function optimisticMoveProjectNotesToTrash(
	localStore: OptimisticLocalStore,
	workspaceId: Id<"workspaces">,
	projectId: Id<"projects">,
) {
	const timestamp = Date.now();
	const projectNotes = removeOptimisticNotes(localStore, {
		archived: false,
		shouldRemove: (note) => note.projectId === projectId,
		workspaceId,
	});
	const projectNoteIds = new Set(projectNotes.map((note) => note._id));
	for (const note of projectNotes) {
		insertOptimisticNote(localStore, {
			archived: true,
			note: {
				...note,
				isArchived: true,
				archivedAt: timestamp,
				updatedAt: timestamp,
			},
			workspaceId,
		});
	}

	for (const note of projectNotes) {
		const activeNote = localStore.getQuery(api.notes.get, {
			workspaceId,
			id: note._id,
		});
		if (activeNote !== undefined) {
			localStore.setQuery(api.notes.get, { workspaceId, id: note._id }, null);
		}

		archiveNoteChats(localStore, workspaceId, note._id);
	}

	const latestNote = localStore.getQuery(api.notes.getLatest, { workspaceId });
	if (latestNote && projectNoteIds.has(latestNote._id)) {
		localStore.setQuery(api.notes.getLatest, { workspaceId }, null);
	}
}
