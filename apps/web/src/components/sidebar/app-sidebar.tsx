"use client";

import { matchesApplicationShortcut } from "@workspace/platform/application-shortcuts";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	useSidebarShell,
} from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { useQuery } from "convex/react";
import { FileText, MessageCircle } from "lucide-react";
import * as React from "react";
import type { AppUser, AppView, NavigableAppView } from "@/app/app-types";
import type { AutomationListItem } from "@/components/automations/automation-types";
import { InboxSheet } from "@/components/inbox/inbox-sheet";
import { SidebarNavigation } from "@/components/nav/nav-main";
import { NavNotes } from "@/components/nav/nav-notes";
import { NavProjects } from "@/components/nav/nav-projects";
import { NavStarred } from "@/components/nav/nav-starred";
import { NavTrash } from "@/components/nav/nav-trash";
import {
	applyProjectAppearancePreview,
	type ProjectAppearancePreview,
} from "@/components/projects/project-appearance-preview";
import { RecipesDialogEntry } from "@/components/recipes/recipes-dialog-entry";
import type { SearchCommandItem } from "@/components/search/search-command";
import { SearchCommandEntry } from "@/components/search/search-command-entry";
import { SettingsDialogEntry } from "@/components/settings/settings-dialog-entry";
import type { SettingsPage } from "@/components/settings/settings-types";
import { NavHelp } from "@/components/sidebar/nav-help";
import { NavUser } from "@/components/sidebar/nav-user";
import { SidebarHeaderUtilities } from "@/components/sidebar/sidebar-header-utilities";
import { SidebarHistoryControls } from "@/components/sidebar/sidebar-history-controls";
import { TemplatesDialogEntry } from "@/components/templates/templates-dialog-entry";
import { WorkspaceSwitcher } from "@/components/workspaces/workspace-switcher";
import { useRecordingNoteId } from "@/hooks/use-transcription-session";
import { useApplicationCommand } from "@/lib/application-command";
import { getChatId } from "@/lib/chat";
import type { ChatPluginSelection } from "@/lib/chat-plugin-prefill";
import {
	createSidebarNavigationItems,
	type SidebarNavigationItem,
} from "@/lib/navigation";
import { getNoteDisplayTitle } from "@/lib/note-title";
import type { WorkspaceRecord } from "@/lib/workspaces";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

type NoteNavigationSource = "notes" | "projects" | "starred";

type SidebarInboxItem = NonNullable<
	ReturnType<typeof useAppSidebarModel>["inboxItems"]
>[number];

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
	workspaces: Array<WorkspaceRecord>;
	activeWorkspaceId: Id<"workspaces"> | null;
	currentView: AppView;
	inboxOpen: boolean;
	user: AppUser;
	chats: Array<Doc<"chats">> | undefined;
	activeStreamingChatIds?: ReadonlySet<string>;
	automations: AutomationListItem[] | undefined;
	notes: Array<Doc<"notes">> | undefined;
	hasMoreNotes: boolean;
	isLoadingMoreNotes: boolean;
	onLoadMoreNotes: () => void;
	sharedNotes: Array<Doc<"notes">> | undefined;
	projectAppearancePreview: ProjectAppearancePreview | null;
	onWorkspaceSelect: (workspaceId: Id<"workspaces">) => void;
	onWorkspaceCreate: (input: { name: string }) => Promise<WorkspaceRecord>;
	onViewChange: (view: NavigableAppView) => void;
	onInboxOpenChange: (open: boolean) => void;
	settingsOpen: boolean;
	settingsPage?: SettingsPage;
	onSettingsOpenChange: (open: boolean, page?: SettingsPage) => void;
	onStartChatWithPlugin: (plugin: ChatPluginSelection) => void;
	onSignOut: () => void;
	signingOut?: boolean;
	desktopSafeTop?: boolean;
	currentChatId: string | null;
	currentChatTitle?: string;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	onChatSelect: (chatId: string) => void;
	onAddAutomation?: (chatId: string) => void;
	onNotePrefetch: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onProjectSelect: (projectId: Id<"projects">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
	onCreateNote: () => void;
	onCreateNoteInsideProject: (projectId: Id<"projects">) => void;
};

type SidebarUiState = {
	searchOpen: boolean;
	chatSearchOpen: boolean;
	trashOpen: boolean;
	recipesOpen: boolean;
	templatesOpen: boolean;
	optimisticReadInboxItemIds: Set<string>;
};

type SidebarUiAction =
	| {
			type: "setOpen";
			key:
				| "searchOpen"
				| "chatSearchOpen"
				| "trashOpen"
				| "recipesOpen"
				| "templatesOpen";
			value: boolean;
	  }
	| { type: "resetReadInboxItems" }
	| { type: "markInboxItemsRead"; itemIds: string[] };

const createInitialSidebarUiState = (): SidebarUiState => ({
	searchOpen: false,
	chatSearchOpen: false,
	trashOpen: false,
	recipesOpen: false,
	templatesOpen: false,
	optimisticReadInboxItemIds: new Set(),
});

function sidebarUiReducer(
	state: SidebarUiState,
	action: SidebarUiAction,
): SidebarUiState {
	switch (action.type) {
		case "setOpen":
			return {
				...state,
				[action.key]: action.value,
			};
		case "resetReadInboxItems":
			return {
				...state,
				optimisticReadInboxItemIds: new Set(),
			};
		case "markInboxItemsRead": {
			const nextReadItemIds = new Set(state.optimisticReadInboxItemIds);
			for (const itemId of action.itemIds) {
				nextReadItemIds.add(itemId);
			}

			return {
				...state,
				optimisticReadInboxItemIds: nextReadItemIds,
			};
		}
	}
}

function useMobileSidebarNavigation({
	dispatchUi,
	isMobile,
	onChatSelect,
	onCreateNote,
	onInboxOpenChange,
	onNoteSelect,
	onProjectSelect,
	onViewChange,
	onWorkspaceSelect,
	setOpenMobile,
}: {
	dispatchUi: React.ActionDispatch<[action: SidebarUiAction]>;
	isMobile: boolean;
	onChatSelect: (chatId: string) => void;
	onCreateNote: () => void;
	onInboxOpenChange: (open: boolean) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onProjectSelect: (projectId: Id<"projects">) => void;
	onViewChange: (view: NavigableAppView) => void;
	onWorkspaceSelect: (workspaceId: Id<"workspaces">) => void;
	setOpenMobile: (open: boolean) => void;
}) {
	const closeMobileSidebar = React.useCallback(() => {
		if (!isMobile) {
			return;
		}

		setOpenMobile(false);
	}, [isMobile, setOpenMobile]);

	const handleSearchOpen = React.useCallback(() => {
		closeMobileSidebar();
		dispatchUi({
			type: "setOpen",
			key: "chatSearchOpen",
			value: false,
		});
		dispatchUi({
			type: "setOpen",
			key: "searchOpen",
			value: true,
		});
	}, [closeMobileSidebar, dispatchUi]);

	const handleChatSearchOpen = React.useCallback(() => {
		closeMobileSidebar();
		dispatchUi({
			type: "setOpen",
			key: "searchOpen",
			value: false,
		});
		dispatchUi({
			type: "setOpen",
			key: "chatSearchOpen",
			value: true,
		});
	}, [closeMobileSidebar, dispatchUi]);

	const handleInboxOpenChange = React.useCallback(
		(open: boolean) => {
			if (open) {
				closeMobileSidebar();
			}

			onInboxOpenChange(open);
		},
		[closeMobileSidebar, onInboxOpenChange],
	);

	const handleViewChange = React.useCallback(
		(view: NavigableAppView) => {
			closeMobileSidebar();
			onViewChange(view);
		},
		[closeMobileSidebar, onViewChange],
	);

	const handleWorkspaceSelect = React.useCallback(
		(workspaceId: Id<"workspaces">) => {
			closeMobileSidebar();
			onWorkspaceSelect(workspaceId);
		},
		[closeMobileSidebar, onWorkspaceSelect],
	);

	const handleChatSelect = React.useCallback(
		(chatId: string) => {
			closeMobileSidebar();
			onChatSelect(chatId);
		},
		[closeMobileSidebar, onChatSelect],
	);

	const handleNoteSelect = React.useCallback(
		(noteId: Id<"notes">) => {
			closeMobileSidebar();
			onNoteSelect(noteId);
		},
		[closeMobileSidebar, onNoteSelect],
	);

	const handleProjectSelect = React.useCallback(
		(projectId: Id<"projects">) => {
			closeMobileSidebar();
			onProjectSelect(projectId);
		},
		[closeMobileSidebar, onProjectSelect],
	);

	const handleCreateNote = React.useCallback(() => {
		closeMobileSidebar();
		onCreateNote();
	}, [closeMobileSidebar, onCreateNote]);

	return {
		handleChatSearchOpen,
		handleChatSelect,
		handleCreateNote,
		handleInboxOpenChange,
		handleNoteSelect,
		handleProjectSelect,
		handleSearchOpen,
		handleViewChange,
		handleWorkspaceSelect,
	};
}

function useAppSidebarModel({
	activeWorkspaceId,
	automations,
	chats,
	currentNoteId,
	currentNoteTitle,
	currentView,
	inboxOpen,
	isMobile,
	notes,
	projects,
	sharedNotes,
	onChatSelect,
	onCreateNote,
	onInboxOpenChange,
	onNoteSelect,
	onProjectSelect,
	onSettingsOpenChange,
	onViewChange,
	onWorkspaceSelect,
	setOpenMobile,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	automations: AutomationListItem[] | undefined;
	chats: Array<Doc<"chats">> | undefined;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	currentView: AppView;
	inboxOpen: boolean;
	isMobile: boolean;
	notes: Array<Doc<"notes">> | undefined;
	projects: Array<Doc<"projects">> | undefined;
	sharedNotes: Array<Doc<"notes">> | undefined;
	onChatSelect: (chatId: string) => void;
	onCreateNote: () => void;
	onInboxOpenChange: (open: boolean) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onProjectSelect: (projectId: Id<"projects">) => void;
	onSettingsOpenChange: (open: boolean, page?: SettingsPage) => void;
	onViewChange: (view: NavigableAppView) => void;
	onWorkspaceSelect: (workspaceId: Id<"workspaces">) => void;
	setOpenMobile: (open: boolean) => void;
}) {
	const [uiState, dispatchUi] = React.useReducer(
		sidebarUiReducer,
		undefined,
		createInitialSidebarUiState,
	);
	const mobileNavigation = useMobileSidebarNavigation({
		dispatchUi,
		isMobile,
		onChatSelect,
		onCreateNote,
		onInboxOpenChange,
		onNoteSelect,
		onProjectSelect,
		onViewChange,
		onWorkspaceSelect,
		setOpenMobile,
	});
	React.useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (!matchesApplicationShortcut(event, "search-chats")) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			mobileNavigation.handleChatSearchOpen();
		};

		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [mobileNavigation.handleChatSearchOpen]);
	const inboxItems = useQuery(
		api.inboxItems.list,
		activeWorkspaceId
			? { workspaceId: activeWorkspaceId, view: "unread" }
			: "skip",
	);
	const unreadInboxCount =
		inboxItems?.filter(
			(item) => !uiState.optimisticReadInboxItemIds.has(String(item._id)),
		).length ?? 0;
	const activeAutomationCount =
		automations?.filter((automation) => !automation.isPaused).length ?? 0;
	const sharedNoteCount = sharedNotes?.length ?? 0;
	const recordingNoteId = useRecordingNoteId();

	React.useEffect(() => {
		const workspaceScope = activeWorkspaceId ?? "no-workspace";

		if (!workspaceScope) {
			return;
		}

		dispatchUi({ type: "resetReadInboxItems" });
	}, [activeWorkspaceId]);

	const navItems = React.useMemo(
		() =>
			createSidebarNavigationItems({
				counts: {
					activeAutomations: activeAutomationCount,
					sharedNotes: sharedNoteCount,
					unreadInboxItems: unreadInboxCount,
				},
				currentView,
				inboxOpen,
			}),
		[
			activeAutomationCount,
			currentView,
			inboxOpen,
			sharedNoteCount,
			unreadInboxCount,
		],
	);
	const projectNamesById = React.useMemo(
		() =>
			new Map((projects ?? []).map((project) => [project._id, project.name])),
		[projects],
	);
	const searchItems = React.useMemo<SearchCommandItem[]>(
		() =>
			(notes ?? [])
				.map((note) => ({
					id: note._id,
					title: getNoteDisplayTitle(
						note._id === currentNoteId && currentNoteTitle?.trim()
							? currentNoteTitle
							: note.title,
					),
					kind: "note" as const,
					icon: FileText,
					projectName: note.projectId
						? projectNamesById.get(note.projectId)
						: undefined,
					updatedAt: note.updatedAt,
				}))
				.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)),
		[currentNoteId, currentNoteTitle, notes, projectNamesById],
	);
	const chatSearchItems = React.useMemo<SearchCommandItem[]>(
		() =>
			(chats ?? [])
				.map((chat) => ({
					id: getChatId(chat),
					title: chat.title || "New chat",
					kind: "chat" as const,
					icon: MessageCircle,
					preview: chat.preview.trim() || undefined,
					updatedAt: chat.updatedAt,
				}))
				.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)),
		[chats],
	);
	const handleDialogOpenChange = React.useCallback(
		(
			key: "searchOpen" | "chatSearchOpen" | "recipesOpen" | "templatesOpen",
			value: boolean,
		) => {
			dispatchUi({
				type: "setOpen",
				key,
				value,
			});
		},
		[],
	);
	const handleMarkInboxItemsRead = React.useCallback((itemIds: string[]) => {
		dispatchUi({ type: "markInboxItemsRead", itemIds });
	}, []);
	const handleTrashOpenChange = React.useCallback((open: boolean) => {
		dispatchUi({
			type: "setOpen",
			key: "trashOpen",
			value: open,
		});
	}, []);
	const handleRecipesOpen = React.useCallback(() => {
		dispatchUi({
			type: "setOpen",
			key: "recipesOpen",
			value: true,
		});
	}, []);
	const handleTemplatesOpen = React.useCallback(() => {
		dispatchUi({
			type: "setOpen",
			key: "templatesOpen",
			value: true,
		});
	}, []);
	const handleSettingsOpen = React.useCallback(() => {
		onSettingsOpenChange(true, "Profile");
	}, [onSettingsOpenChange]);

	return {
		...mobileNavigation,
		handleDialogOpenChange,
		handleMarkInboxItemsRead,
		handleRecipesOpen,
		handleSettingsOpen,
		handleTemplatesOpen,
		handleTrashOpenChange,
		chatSearchItems,
		inboxItems,
		navItems,
		recordingNoteId,
		searchItems,
		uiState,
	};
}

export function AppSidebar({
	workspaces,
	activeWorkspaceId,
	currentView,
	inboxOpen,
	user,
	chats,
	activeStreamingChatIds,
	automations,
	notes,
	hasMoreNotes,
	isLoadingMoreNotes,
	onLoadMoreNotes,
	sharedNotes,
	projectAppearancePreview,
	onWorkspaceSelect,
	onWorkspaceCreate,
	onViewChange,
	onInboxOpenChange,
	settingsOpen,
	settingsPage = "Profile",
	onSettingsOpenChange,
	onStartChatWithPlugin,
	onSignOut,
	signingOut = false,
	desktopSafeTop = false,
	currentChatId,
	currentChatTitle,
	currentNoteId,
	currentNoteTitle,
	onChatSelect,
	onAddAutomation,
	onNotePrefetch,
	onNoteSelect,
	onProjectSelect,
	onNoteTitleChange,
	onNoteTrashed,
	onCreateNote,
	onCreateNoteInsideProject,
	...props
}: AppSidebarProps) {
	const { isMobile, setOpenMobile, state, toggleSidebar } = useSidebarShell();
	const queriedProjects = useQuery(
		api.projects.list,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const projects = React.useMemo(
		() =>
			queriedProjects
				? applyProjectAppearancePreview(
						queriedProjects,
						projectAppearancePreview,
					)
				: undefined,
		[projectAppearancePreview, queriedProjects],
	);
	const model = useAppSidebarModel({
		activeWorkspaceId,
		automations,
		chats,
		currentNoteId,
		currentNoteTitle,
		currentView,
		inboxOpen,
		isMobile,
		notes,
		projects,
		sharedNotes,
		onChatSelect,
		onCreateNote,
		onInboxOpenChange,
		onNoteSelect,
		onProjectSelect,
		onSettingsOpenChange,
		onViewChange,
		onWorkspaceSelect,
		setOpenMobile,
	});
	useApplicationCommand("toggle-sidebar", toggleSidebar);

	return (
		<>
			<Sidebar data-app-sidebar="true" data-desktop-nonselectable {...props}>
				<AppSidebarHeaderSection
					activeWorkspaceId={activeWorkspaceId}
					currentView={currentView}
					desktopSafeTop={desktopSafeTop}
					onCreateNote={model.handleCreateNote}
					onSearchOpen={model.handleSearchOpen}
					onWorkspaceCreate={onWorkspaceCreate}
					onWorkspaceSelect={model.handleWorkspaceSelect}
					workspaces={workspaces}
				/>
				<AppSidebarContentSection
					activeWorkspaceId={activeWorkspaceId}
					chats={chats}
					activeStreamingChatIds={activeStreamingChatIds}
					automations={automations}
					currentChatId={currentChatId}
					currentChatTitle={currentChatTitle}
					currentNoteId={currentNoteId}
					currentNoteTitle={currentNoteTitle}
					currentView={currentView}
					onChatSelect={model.handleChatSelect}
					onAddAutomation={onAddAutomation}
					inboxOpen={inboxOpen}
					navItems={model.navItems}
					notes={notes}
					hasMoreNotes={hasMoreNotes}
					isLoadingMoreNotes={isLoadingMoreNotes}
					onLoadMoreNotes={onLoadMoreNotes}
					onCreateNote={model.handleCreateNote}
					onCreateNoteInsideProject={onCreateNoteInsideProject}
					onInboxOpenChange={model.handleInboxOpenChange}
					onNotePrefetch={onNotePrefetch}
					onNoteSelect={model.handleNoteSelect}
					onProjectSelect={model.handleProjectSelect}
					onNoteTitleChange={onNoteTitleChange}
					onNoteTrashed={onNoteTrashed}
					onViewChange={model.handleViewChange}
					projects={projects}
					recordingNoteId={model.recordingNoteId}
				/>
				<AppSidebarFooterSection
					onRecipesOpen={model.handleRecipesOpen}
					onSettingsOpen={model.handleSettingsOpen}
					onSignOut={onSignOut}
					onTemplatesOpen={model.handleTemplatesOpen}
					onTrashOpenChange={model.handleTrashOpenChange}
					signingOut={signingOut}
					trashOpen={model.uiState.trashOpen}
					user={user}
				/>
			</Sidebar>
			<AppSidebarDialogs
				activeWorkspaceId={activeWorkspaceId}
				chatSearchItems={model.chatSearchItems}
				chatSearchOpen={model.uiState.chatSearchOpen}
				onChatSelect={model.handleChatSelect}
				onNoteSelect={model.handleNoteSelect}
				onOpenChange={model.handleDialogOpenChange}
				onSettingsOpenChange={onSettingsOpenChange}
				onStartChatWithPlugin={onStartChatWithPlugin}
				searchItems={model.searchItems}
				settingsOpen={settingsOpen}
				settingsPage={settingsPage}
				templatesOpen={model.uiState.templatesOpen}
				recipesOpen={model.uiState.recipesOpen}
				searchOpen={model.uiState.searchOpen}
				user={user}
				workspaces={workspaces}
			/>
			<AppSidebarInboxSheet
				desktopSafeTop={desktopSafeTop}
				inboxItems={model.inboxItems}
				inboxOpen={inboxOpen}
				isMobile={isMobile}
				onInboxOpenChange={model.handleInboxOpenChange}
				onMarkInboxItemsRead={model.handleMarkInboxItemsRead}
				sidebarState={state}
				user={user}
			/>
		</>
	);
}

const AppSidebarFooterSection = React.memo(function AppSidebarFooterSection({
	onRecipesOpen,
	onSettingsOpen,
	onSignOut,
	onTemplatesOpen,
	onTrashOpenChange,
	signingOut,
	trashOpen,
	user,
}: {
	onRecipesOpen: () => void;
	onSettingsOpen: () => void;
	onSignOut: () => void;
	onTemplatesOpen: () => void;
	onTrashOpenChange: (open: boolean) => void;
	signingOut: boolean;
	trashOpen: boolean;
	user: Pick<AppUser, "avatar" | "name">;
}) {
	return (
		<SidebarFooter>
			<NavTrash open={trashOpen} onOpenChange={onTrashOpenChange} />
			<div className="flex items-center gap-1">
				<div className="min-w-0 flex-1">
					<NavUser
						user={user}
						onRecipesOpen={onRecipesOpen}
						onTemplatesOpen={onTemplatesOpen}
						onSettingsOpen={onSettingsOpen}
						onSignOut={onSignOut}
						signingOut={signingOut}
					/>
				</div>
				<NavHelp />
			</div>
		</SidebarFooter>
	);
});

const AppSidebarHeaderSection = React.memo(function AppSidebarHeaderSection({
	activeWorkspaceId,
	currentView,
	desktopSafeTop,
	onCreateNote,
	onSearchOpen,
	onWorkspaceCreate,
	onWorkspaceSelect,
	workspaces,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	currentView: AppView;
	desktopSafeTop: boolean;
	onCreateNote: () => void;
	onSearchOpen: () => void;
	onWorkspaceCreate: (input: { name: string }) => Promise<WorkspaceRecord>;
	onWorkspaceSelect: (workspaceId: Id<"workspaces">) => void;
	workspaces: Array<WorkspaceRecord>;
}) {
	return (
		<SidebarHeader
			data-app-region={desktopSafeTop ? "drag" : undefined}
			className={desktopSafeTop ? "relative gap-1 pb-1 pt-8" : "gap-1 pb-1"}
		>
			{desktopSafeTop ? <SidebarHistoryControls /> : null}
			<div
				data-app-region={desktopSafeTop ? "no-drag" : undefined}
				className={cn(
					"flex items-start gap-1",
					desktopSafeTop && currentView !== "notFound" && "mt-4",
				)}
			>
				<div className="min-w-0 flex-1">
					<WorkspaceSwitcher
						workspaces={workspaces}
						activeWorkspaceId={activeWorkspaceId}
						onSelect={onWorkspaceSelect}
						onCreateWorkspace={onWorkspaceCreate}
					/>
				</div>
				<SidebarHeaderUtilities
					onCreateNote={onCreateNote}
					onSearchOpen={onSearchOpen}
				/>
			</div>
		</SidebarHeader>
	);
});

function useSidebarNoteSelection({
	currentNoteId,
	currentView,
	onNoteSelect,
}: {
	currentNoteId: Id<"notes"> | null;
	currentView: AppView;
	onNoteSelect: (noteId: Id<"notes">) => void;
}) {
	const activeNoteId = currentView === "note" ? currentNoteId : null;
	const [lastNoteSelection, setLastNoteSelection] = React.useState<{
		noteId: Id<"notes">;
		source: NoteNavigationSource;
	} | null>(null);
	const activeNoteNavigationSource =
		lastNoteSelection?.noteId === activeNoteId
			? lastNoteSelection.source
			: null;
	const selectNoteFromSource = React.useCallback(
		(noteId: Id<"notes">, source: NoteNavigationSource) => {
			setLastNoteSelection({ noteId, source });
			onNoteSelect(noteId);
		},
		[onNoteSelect],
	);
	const handleStarredNoteSelect = React.useCallback(
		(noteId: Id<"notes">) => selectNoteFromSource(noteId, "starred"),
		[selectNoteFromSource],
	);
	const handleNotesNoteSelect = React.useCallback(
		(noteId: Id<"notes">) => selectNoteFromSource(noteId, "notes"),
		[selectNoteFromSource],
	);
	const handleProjectNoteSelect = React.useCallback(
		(noteId: Id<"notes">) => selectNoteFromSource(noteId, "projects"),
		[selectNoteFromSource],
	);

	return {
		activeNoteId,
		autoRevealActiveNoteProject: activeNoteNavigationSource !== "starred",
		handleNotesNoteSelect,
		handleProjectNoteSelect,
		handleStarredNoteSelect,
	};
}

const AppSidebarContentSection = React.memo(function AppSidebarContentSection({
	activeWorkspaceId,
	chats,
	activeStreamingChatIds,
	automations,
	currentChatId,
	currentChatTitle,
	currentNoteId,
	currentNoteTitle,
	currentView,
	onChatSelect,
	onAddAutomation,
	inboxOpen,
	navItems,
	notes,
	hasMoreNotes,
	isLoadingMoreNotes,
	onLoadMoreNotes,
	onCreateNote,
	onCreateNoteInsideProject,
	onInboxOpenChange,
	onNotePrefetch,
	onNoteSelect,
	onProjectSelect,
	onNoteTitleChange,
	onNoteTrashed,
	onViewChange,
	projects,
	recordingNoteId,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	chats: Array<Doc<"chats">> | undefined;
	activeStreamingChatIds?: ReadonlySet<string>;
	automations: AutomationListItem[] | undefined;
	currentChatId: string | null;
	currentChatTitle?: string;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle?: string;
	currentView: AppView;
	onChatSelect: (chatId: string) => void;
	onAddAutomation?: (chatId: string) => void;
	inboxOpen: boolean;
	navItems: SidebarNavigationItem[];
	notes: Array<Doc<"notes">> | undefined;
	hasMoreNotes: boolean;
	isLoadingMoreNotes: boolean;
	onLoadMoreNotes: () => void;
	onCreateNote: () => void;
	onCreateNoteInsideProject: (projectId: Id<"projects">) => void;
	onInboxOpenChange: (open: boolean) => void;
	onNotePrefetch: (noteId: Id<"notes">) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onProjectSelect: (projectId: Id<"projects">) => void;
	onNoteTitleChange?: (title: string) => void;
	onNoteTrashed?: (noteId: Id<"notes">) => void;
	onViewChange: (view: NavigableAppView) => void;
	projects: Array<Doc<"projects">> | undefined;
	recordingNoteId: Id<"notes"> | null;
}) {
	const automationChatIds = React.useMemo(
		() => new Set((automations ?? []).map((automation) => automation.chatId)),
		[automations],
	);
	const {
		activeNoteId,
		autoRevealActiveNoteProject,
		handleNotesNoteSelect,
		handleProjectNoteSelect,
		handleStarredNoteSelect,
	} = useSidebarNoteSelection({
		currentNoteId,
		currentView,
		onNoteSelect,
	});

	return (
		<SidebarContent viewportClassName="scroll-fade-b [--scroll-fade-reveal:2rem]">
			<SidebarNavigation
				items={navItems}
				onViewChange={onViewChange}
				onInboxToggle={() => onInboxOpenChange(!inboxOpen)}
			/>
			<NavStarred
				chats={chats}
				activeStreamingChatIds={activeStreamingChatIds}
				automationChatIds={automationChatIds}
				notes={notes}
				projects={projects}
				workspaceId={activeWorkspaceId}
				currentChatId={currentView === "chat" ? currentChatId : null}
				currentChatTitle={currentChatTitle}
				currentNoteId={activeNoteId}
				currentNoteTitle={currentNoteTitle}
				recordingNoteId={recordingNoteId}
				onChatSelect={onChatSelect}
				onAddAutomation={onAddAutomation}
				onNotePrefetch={onNotePrefetch}
				onNoteSelect={handleStarredNoteSelect}
				onProjectSelect={onProjectSelect}
				onNoteTitleChange={onNoteTitleChange}
				onNoteTrashed={onNoteTrashed}
			/>
			<NavNotes
				notes={notes}
				currentNoteId={activeNoteId}
				currentNoteTitle={currentNoteTitle}
				recordingNoteId={recordingNoteId}
				onPrefetchNote={onNotePrefetch}
				onNoteSelect={handleNotesNoteSelect}
				onNoteTitleChange={onNoteTitleChange}
				onNoteTrashed={onNoteTrashed}
				onCreateNote={onCreateNote}
				hasMoreNotes={hasMoreNotes}
				isLoadingMoreNotes={isLoadingMoreNotes}
				onLoadMoreNotes={onLoadMoreNotes}
			/>
			<NavProjects
				projects={projects}
				notes={notes}
				workspaceId={activeWorkspaceId}
				currentNoteId={activeNoteId}
				currentNoteTitle={currentNoteTitle}
				recordingNoteId={recordingNoteId}
				autoRevealActiveNoteProject={autoRevealActiveNoteProject}
				onPrefetchNote={onNotePrefetch}
				onNoteSelect={handleProjectNoteSelect}
				onProjectSelect={onProjectSelect}
				onNoteTitleChange={onNoteTitleChange}
				onNoteTrashed={onNoteTrashed}
				onCreateNoteInsideProject={onCreateNoteInsideProject}
			/>
		</SidebarContent>
	);
});

const AppSidebarDialogs = React.memo(function AppSidebarDialogs({
	activeWorkspaceId,
	chatSearchItems,
	chatSearchOpen,
	onChatSelect,
	onNoteSelect,
	onOpenChange,
	onSettingsOpenChange,
	onStartChatWithPlugin,
	searchItems,
	settingsOpen,
	settingsPage,
	templatesOpen,
	recipesOpen,
	searchOpen,
	user,
	workspaces,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	chatSearchItems: SearchCommandItem[];
	chatSearchOpen: boolean;
	onChatSelect: (chatId: string) => void;
	onNoteSelect: (noteId: Id<"notes">) => void;
	onOpenChange: (
		key: "searchOpen" | "chatSearchOpen" | "recipesOpen" | "templatesOpen",
		value: boolean,
	) => void;
	onSettingsOpenChange: (open: boolean, page?: SettingsPage) => void;
	onStartChatWithPlugin: (plugin: ChatPluginSelection) => void;
	searchItems: SearchCommandItem[];
	settingsOpen: boolean;
	settingsPage: SettingsPage;
	templatesOpen: boolean;
	recipesOpen: boolean;
	searchOpen: boolean;
	user: AppUser;
	workspaces: Array<WorkspaceRecord>;
}) {
	const handleSearchOpenChange = React.useCallback(
		(open: boolean) => onOpenChange("searchOpen", open),
		[onOpenChange],
	);
	const handleChatSearchOpenChange = React.useCallback(
		(open: boolean) => onOpenChange("chatSearchOpen", open),
		[onOpenChange],
	);
	const handleSearchSelectItem = React.useCallback(
		(itemId: string) => {
			const selectedItem = searchItems.find((item) => item.id === itemId);
			if (!selectedItem) {
				return;
			}

			onNoteSelect(itemId as Id<"notes">);
		},
		[onNoteSelect, searchItems],
	);
	const handleChatSearchSelectItem = React.useCallback(
		(itemId: string) => {
			const selectedItem = chatSearchItems.find((item) => item.id === itemId);
			if (!selectedItem) {
				return;
			}

			onChatSelect(itemId);
		},
		[chatSearchItems, onChatSelect],
	);
	const selectedWorkspace = React.useMemo(
		() =>
			workspaces.find((workspace) => workspace._id === activeWorkspaceId) ??
			null,
		[activeWorkspaceId, workspaces],
	);
	const handleSettingsPageChange = React.useCallback(
		(page: SettingsPage) => onSettingsOpenChange(true, page),
		[onSettingsOpenChange],
	);
	const handleRecipesOpenChange = React.useCallback(
		(open: boolean) => onOpenChange("recipesOpen", open),
		[onOpenChange],
	);
	const handleTemplatesOpenChange = React.useCallback(
		(open: boolean) => onOpenChange("templatesOpen", open),
		[onOpenChange],
	);

	return (
		<>
			<SearchCommandEntry
				open={searchOpen}
				onOpenChange={handleSearchOpenChange}
				items={searchItems}
				workspaceId={activeWorkspaceId}
				showKeyboardHintsFooter
				onSelectItem={handleSearchSelectItem}
			/>
			<SearchCommandEntry
				open={chatSearchOpen}
				onOpenChange={handleChatSearchOpenChange}
				items={chatSearchItems}
				workspaceId={activeWorkspaceId}
				searchKind="chats"
				searchPlaceholder="Search chats..."
				searchDescription="Search chats..."
				showKeyboardHintsFooter
				keyboardHintsSearchKind="chats"
				onSelectItem={handleChatSearchSelectItem}
			/>
			<SettingsDialogEntry
				open={settingsOpen}
				onOpenChange={onSettingsOpenChange}
				user={user}
				workspace={selectedWorkspace}
				initialPage={settingsPage}
				onPageChange={handleSettingsPageChange}
				onTryPlugin={onStartChatWithPlugin}
			/>
			<RecipesDialogEntry
				open={recipesOpen}
				onOpenChange={handleRecipesOpenChange}
			/>
			<TemplatesDialogEntry
				open={templatesOpen}
				onOpenChange={handleTemplatesOpenChange}
			/>
		</>
	);
});

const AppSidebarInboxSheet = React.memo(function AppSidebarInboxSheet({
	desktopSafeTop,
	inboxItems,
	inboxOpen,
	isMobile,
	onInboxOpenChange,
	onMarkInboxItemsRead,
	sidebarState,
	user,
}: {
	desktopSafeTop: boolean;
	inboxItems: SidebarInboxItem[] | undefined;
	inboxOpen: boolean;
	isMobile: boolean;
	onInboxOpenChange: (open: boolean) => void;
	onMarkInboxItemsRead: (itemIds: string[]) => void;
	sidebarState: "expanded" | "collapsed";
	user: AppUser;
}) {
	const handleMarkAllRead = React.useCallback(() => {
		if (!inboxItems) {
			return;
		}

		onMarkInboxItemsRead(inboxItems.map((item) => String(item._id)));
	}, [inboxItems, onMarkInboxItemsRead]);

	return (
		<InboxSheet
			open={inboxOpen}
			onOpenChange={onInboxOpenChange}
			sidebarState={sidebarState}
			isMobile={isMobile}
			desktopSafeTop={desktopSafeTop}
			currentUser={user}
			initialAllItems={inboxItems}
			onMarkItemsRead={onMarkInboxItemsRead}
			onMarkAllRead={handleMarkAllRead}
		/>
	);
});
