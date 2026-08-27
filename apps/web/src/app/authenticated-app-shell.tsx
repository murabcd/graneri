import {
	getDesktopMeta,
	isDesktopRuntime,
	setDesktopActiveWorkspaceId,
	setDesktopActiveWorkspaceNotificationPreferences,
} from "@workspace/platform/desktop";
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
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Kbd } from "@workspace/ui/components/kbd";
import { Separator } from "@workspace/ui/components/separator";
import {
	SidebarProvider,
	SidebarTrigger,
	useDockedPanelWidths,
	useSidebarShell,
} from "@workspace/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import {
	Clock,
	MoreHorizontal,
	Pencil,
	Plus,
	Star,
	StarOff,
	TextSearch,
	Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
	AppShellContent,
	type AppShellContentView,
} from "@/app/app-shell-content";
import type { AppUser, AppView, UpcomingCalendarEvent } from "@/app/app-types";
import {
	getResolvingPersistedChatIds,
	resolveApplicationView,
	resolveCollectionRoute,
} from "@/app/application-navigation-session";
import { useDesktopCalendarEventRequest } from "@/app/desktop-calendar-event-request";
import {
	buildCalendarEventNoteDocument,
	buildCalendarEventSearchableText,
} from "@/app/location";
import { createPendingPersistedChatRoutesStore } from "@/app/pending-persisted-chat-routes";
import { useApplicationNavigationSession } from "@/app/use-application-navigation-session";
import { useUpcomingCalendar } from "@/app/use-upcoming-calendar";
import type {
	AutomationDraft,
	AutomationListItem,
} from "@/components/automations/automation-types";
import { CreateAutomationDialogEntry } from "@/components/automations/create-automation-dialog-entry";
import { OPEN_NEW_CALENDAR_EVENT } from "@/components/calendar/calendar-page-events";
import { OPEN_CHAT_SUMMARY_EVENT } from "@/components/chat/chat-summary-events";
import { optimisticPatchChat } from "@/components/chat/optimistic-patch-chat";
import { AppShellInset } from "@/components/layout/app-shell-inset";
import {
	ChatBreadcrumbTitleEditor,
	NoteBreadcrumbTitleEditor,
	ProjectBreadcrumbTitleEditor,
} from "@/components/navigation/breadcrumb-title-editor";
import { useBreadcrumbChatTitleEditor } from "@/components/navigation/use-breadcrumb-chat-title-editor";
import { NoteStarButton } from "@/components/note/note-actions-menu";
import { NoteCommentsButton } from "@/components/note/note-comments-button";
import {
	type NoteEditorActions,
	NoteEditorActionsStore,
} from "@/components/note/note-editor-actions-store";
import { NoteHeaderActionsMenu } from "@/components/note/note-header-actions-menu";
import type { ProjectAppearancePreview } from "@/components/projects/project-appearance-preview";
import type { SettingsPage } from "@/components/settings/settings-types";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { NoteTemplateSelect } from "@/components/templates/note-template-select";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { ActiveWorkspaceProvider } from "@/hooks/active-workspace-provider";
import { useAutomationActions } from "@/hooks/use-automation-actions";
import { useAutomationNotifications } from "@/hooks/use-automation-notifications";
import { prefetchChatMessagesSnapshot } from "@/hooks/use-chat-messages-snapshot";
import { useNoteNavigationPreparation } from "@/hooks/use-note-navigation-preparation";
import { applyDesktopAppearancePreferenceAttributes } from "@/lib/appearance-preferences";
import { type AuthSession, authClient } from "@/lib/auth-client";
import { getChatId } from "@/lib/chat";
import {
	type ChatPluginPrefill,
	type ChatPluginSelection,
	consumeChatPluginPrefill,
} from "@/lib/chat-plugin-prefill";
import { clearCachedConvexToken } from "@/lib/convex-token";
import {
	DESKTOP_INBOX_PANEL_WIDTH,
	DESKTOP_MAIN_HEADER_CLASS,
	DESKTOP_MAIN_HEADER_CONTENT_CLASS,
	DESKTOP_MAIN_HEADER_LEADING_CLASS,
} from "@/lib/desktop-chrome";
import { logError } from "@/lib/logger";
import { getSidebarViewTitle } from "@/lib/navigation";
import {
	createNoteCaptureRequestId,
	getNoteCaptureRequestIdForAutoStart,
} from "@/lib/note-capture-request";
import { serializeMarkdownToNoteContent } from "@/lib/note-editor";
import type { NoteTemplate } from "@/lib/note-templates";
import { getNoteDisplayTitle } from "@/lib/note-title";
import type { WorkspaceRecord } from "@/lib/workspaces";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

const currentMonthFormatter = new Intl.DateTimeFormat(undefined, {
	month: "long",
});

const currentWeekdayFormatter = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
});

const usePendingPersistedChatRoutes = () => {
	const store = React.useMemo(
		() => createPendingPersistedChatRoutesStore(),
		[],
	);
	const pendingPersistedChatRouteIds = React.useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);

	return {
		addPendingPersistedChatRouteId: store.add,
		pendingPersistedChatRouteIds,
		removePendingPersistedChatRouteId: store.remove,
	};
};

const getDelayUntilNextMinute = (now: Date) => {
	const nextMinute = new Date(now);
	nextMinute.setSeconds(60, 0);

	return nextMinute.getTime() - now.getTime();
};

const getBreadcrumbSectionLabel = ({
	currentView,
	isSharedNote,
}: {
	currentView: AppView;
	isSharedNote: boolean;
}) => {
	if (isSharedNote) {
		return getSidebarViewTitle("shared");
	}

	switch (currentView) {
		case "notFound":
			return "Page Not Found";
		case "chat":
			return getSidebarViewTitle("chat");
		case "calendar":
			return getSidebarViewTitle("calendar");
		case "automation":
			return getSidebarViewTitle("automation");
		case "project":
			return "Projects";
		case "shared":
			return getSidebarViewTitle("shared");
		default:
			return getSidebarViewTitle("home");
	}
};

const resolveActiveWorkspaceId = ({
	activeWorkspaceId,
	workspaces,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	workspaces: Doc<"workspaces">[];
}) => {
	if (activeWorkspaceId) {
		const activeWorkspaceExists = workspaces.some(
			(workspace) => workspace._id === activeWorkspaceId,
		);

		if (activeWorkspaceExists) {
			return activeWorkspaceId;
		}
	}

	return workspaces[0]?._id ?? null;
};

const useCurrentDate = () => {
	const [currentDate, setCurrentDate] = React.useState(() => new Date());

	React.useEffect(() => {
		let timeoutId: number | undefined;
		let intervalId: number | undefined;

		const updateCurrentDate = () => {
			const now = new Date();
			setCurrentDate(now);
		};

		timeoutId = window.setTimeout(() => {
			updateCurrentDate();
			intervalId = window.setInterval(updateCurrentDate, 60 * 1000);
		}, getDelayUntilNextMinute(new Date()));

		return () => {
			if (timeoutId !== undefined) {
				window.clearTimeout(timeoutId);
			}

			if (intervalId !== undefined) {
				window.clearInterval(intervalId);
			}
		};
	}, []);

	return currentDate;
};

const toAppUser = (
	session: AuthSession,
	avatarOverride?: string | null,
): AppUser => ({
	name: session.user.name?.trim() || session.user.email || "Unknown user",
	email: session.user.email || "",
	avatar: avatarOverride ?? session.user.image ?? "",
});

const useAppShellState = ({
	session,
	workspaces,
	initialDesktopMac,
}: {
	session: AuthSession;
	workspaces: Array<WorkspaceRecord>;
	initialDesktopMac: boolean;
}) => {
	const convex = useConvex();
	const { isAuthenticated: isConvexAuthenticated } = useConvexAuth();
	const [isDesktopMac, setIsDesktopMac] = React.useState(initialDesktopMac);
	const [automationDialogOpen, setAutomationDialogOpen] = React.useState(false);
	const [editingAutomationId, setEditingAutomationId] =
		React.useState<Id<"automations"> | null>(null);
	const [automationChatId, setAutomationChatId] = React.useState<string | null>(
		null,
	);
	const [isSigningOut, startSignOut] = React.useTransition();
	const [activeWorkspaceId, setActiveWorkspaceId] =
		React.useState<Id<"workspaces"> | null>(() => workspaces[0]?._id ?? null);
	const resolvedActiveWorkspaceId = resolveActiveWorkspaceId({
		// Workspace resolution is pure render derivation; no event handler owns these query inputs.
		activeWorkspaceId,
		// Workspace resolution is pure render derivation; no event handler owns these query inputs.
		workspaces,
	});
	const [draftChatComposerId, setDraftChatComposerId] = React.useState(() =>
		crypto.randomUUID(),
	);
	const [chatPluginPrefill, setChatPluginPrefill] =
		React.useState<ChatPluginPrefill | null>(null);
	const [currentNoteTitleOverride, setCurrentNoteTitleOverride] =
		React.useState<{
			noteId: Id<"notes"> | null;
			title: string;
		} | null>(null);
	const [noteEditorActionsStore] = React.useState(
		() => new NoteEditorActionsStore(),
	);
	const {
		cancelPendingNoteNavigation,
		prefetchNote: handlePrefetchNote,
		prepareNoteNavigation,
	} = useNoteNavigationPreparation({
		workspaceId: resolvedActiveWorkspaceId,
	});
	const currentNoteEditorActions = React.useSyncExternalStore(
		noteEditorActionsStore.subscribe,
		noteEditorActionsStore.getSnapshot,
		noteEditorActionsStore.getSnapshot,
	);
	const setCurrentNoteEditorActions = noteEditorActionsStore.set;
	const [currentNoteCommentsOpener, setCurrentNoteCommentsOpener] =
		React.useState<(() => void) | null>(null);
	const handleLocationSynchronized = React.useCallback(() => {
		cancelPendingNoteNavigation();
		setAutomationDialogOpen(false);
		setEditingAutomationId(null);
		setAutomationChatId(null);
		setCurrentNoteEditorActions(null);
		setCurrentNoteCommentsOpener(null);
	}, [cancelPendingNoteNavigation, setCurrentNoteEditorActions]);
	const navigation = useApplicationNavigationSession({
		onLocationSynchronized: handleLocationSynchronized,
	});
	const {
		clearScheduledAutoStart,
		consumeNoteCaptureIntent,
		currentChatId,
		currentNoteId,
		currentProjectIdString,
		currentRouteNoteId,
		currentView,
		inboxOpen,
		noteCaptureRequestId,
		openChat: navigateChat,
		openNote: navigateNote,
		openProject: navigateProject,
		openView: navigateView,
		pendingCalendarEventRequestId,
		scheduledAutoStartNoteCaptureAt,
		settingsOpen,
		settingsPage,
		setInboxOpen: setNavigationInboxOpen,
		setSettingsOpen: setNavigationSettingsOpen,
		shouldAutoStartNoteCapture,
		shouldStopNoteCaptureWhenMeetingEnds,
		triggerScheduledAutoStart,
	} = navigation;
	const chatComposerId = currentChatId ?? draftChatComposerId;
	const userPreferences = useQuery(
		api.userPreferences.get,
		session?.user && isConvexAuthenticated ? {} : "skip",
	);
	React.useEffect(() => {
		applyDesktopAppearancePreferenceAttributes(userPreferences);
	}, [userPreferences]);
	const creatingNoteRef = React.useRef(false);
	const user = React.useMemo(
		() => toAppUser(session, userPreferences?.avatarUrl),
		[session, userPreferences?.avatarUrl],
	);
	const currentDate = useCurrentDate();
	const currentDayOfMonth = currentDate.getDate();
	const currentMonthLabel = currentMonthFormatter.format(currentDate);
	const currentWeekdayLabel = currentWeekdayFormatter.format(currentDate);
	const currentDayKey = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}-${currentDate.getDate()}`;
	const upcomingCalendar = useUpcomingCalendar({
		accountId: session?.user?.id ?? null,
		currentDayKey,
		isAuthenticated: isConvexAuthenticated,
		workspaceId: resolvedActiveWorkspaceId,
	});
	const handleDesktopCalendarEventUnavailable = React.useCallback(
		(error?: unknown) => {
			logError({
				event: "client.error",
				error,
				message: "Desktop calendar event request is unavailable",
			});
			navigateView("home");
		},
		[navigateView],
	);
	const pendingDesktopCalendarEvent = useDesktopCalendarEventRequest({
		onUnavailable: handleDesktopCalendarEventUnavailable,
		requestId: pendingCalendarEventRequestId,
	});
	const notificationPreferences = useQuery(
		api.notificationPreferences.get,
		isConvexAuthenticated && resolvedActiveWorkspaceId
			? { workspaceId: resolvedActiveWorkspaceId }
			: "skip",
	);
	const createNote = useMutation(api.notes.create);
	const createNoteFromCalendarEvent = useMutation(
		api.notes.createFromCalendarEvent,
	);
	const saveNote = useMutation(api.notes.save);
	const createWorkspace = useMutation(api.workspaces.create);
	const chats = useQuery(
		api.chats.list,
		resolvedActiveWorkspaceId
			? { workspaceId: resolvedActiveWorkspaceId }
			: "skip",
	);
	const {
		addPendingPersistedChatRouteId,
		pendingPersistedChatRouteIds,
		removePendingPersistedChatRouteId,
	} = usePendingPersistedChatRoutes();
	const resolvingPersistedChatIds = getResolvingPersistedChatIds({
		chats,
		pendingPersistedChatRouteIds,
	});
	const activeRunChatIds = useQuery(
		api.assistantRuns.listActiveChatIds,
		resolvedActiveWorkspaceId
			? { workspaceId: resolvedActiveWorkspaceId }
			: "skip",
	);
	const activeStreamingChatIds = React.useMemo(
		() => new Set(activeRunChatIds ?? []),
		[activeRunChatIds],
	);
	const automations = useQuery(
		api.automations.list,
		resolvedActiveWorkspaceId
			? { workspaceId: resolvedActiveWorkspaceId }
			: "skip",
	);
	useAutomationNotifications({
		isDesktopMac,
		workspaceId: resolvedActiveWorkspaceId,
	});
	const projects = useQuery(
		api.projects.list,
		resolvedActiveWorkspaceId
			? { workspaceId: resolvedActiveWorkspaceId }
			: "skip",
	);
	const notes = useQuery(
		api.notes.list,
		resolvedActiveWorkspaceId
			? { workspaceId: resolvedActiveWorkspaceId }
			: "skip",
	);
	const sharedNotes = useQuery(
		api.notes.listShared,
		resolvedActiveWorkspaceId
			? { workspaceId: resolvedActiveWorkspaceId }
			: "skip",
	);
	const normalizedRouteNoteId = useQuery(
		api.notes.normalizeId,
		currentView === "note" && currentRouteNoteId && currentNoteId === null
			? {
					id: currentRouteNoteId,
				}
			: "skip",
	);
	const resolvedCurrentNoteId = currentNoteId ?? normalizedRouteNoteId ?? null;
	const isResolvingCurrentNoteRouteId =
		currentView === "note" &&
		currentRouteNoteId !== null &&
		currentNoteId === null &&
		normalizedRouteNoteId === undefined;
	const hasInvalidCurrentNoteRoute =
		// Route validity is render-time URL/query derivation; navigation is synchronized elsewhere.
		currentView === "note" &&
		// Route validity is render-time URL/query derivation; navigation is synchronized elsewhere.
		currentRouteNoteId !== null &&
		// Route validity is render-time URL/query derivation; navigation is synchronized elsewhere.
		currentNoteId === null &&
		normalizedRouteNoteId === null;
	const listedSelectedNote =
		currentView === "note" && resolvedCurrentNoteId
			? (notes?.find((note) => note._id === resolvedCurrentNoteId) ??
				(notes === undefined ? undefined : null))
			: undefined;
	const selectedNote = useQuery(
		api.notes.get,
		currentView === "note" &&
			!hasInvalidCurrentNoteRoute &&
			resolvedCurrentNoteId &&
			resolvedActiveWorkspaceId
			? {
					workspaceId: resolvedActiveWorkspaceId,
					id: resolvedCurrentNoteId,
				}
			: "skip",
	);
	const resolvedSelectedNote = selectedNote ?? listedSelectedNote;
	const currentNoteTitle =
		currentView === "note"
			? currentNoteTitleOverride?.noteId === resolvedCurrentNoteId
				? currentNoteTitleOverride.title
				: (resolvedSelectedNote?.title ?? "")
			: "";
	const setCurrentNoteTitle = React.useCallback(
		(title: string) => {
			setCurrentNoteTitleOverride({
				noteId: resolvedCurrentNoteId,
				title,
			});
		},
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
		[resolvedCurrentNoteId],
	);
	const isResolvingCurrentNote =
		isResolvingCurrentNoteRouteId ||
		(currentView === "note" &&
			resolvedCurrentNoteId !== null &&
			resolvedSelectedNote === undefined);
	const hasMissingCurrentNote =
		currentView === "note" &&
		resolvedCurrentNoteId !== null &&
		resolvedSelectedNote === null;
	const currentChatRoute = resolveCollectionRoute({
		currentView,
		expectedView: "chat",
		// Route resolution is pure render derivation from URL state, not delayed event work.
		id: currentChatId,
		items: chats,
		matches: (chat, id) => getChatId(chat) === id,
		resolvingIds: resolvingPersistedChatIds,
	});
	const isResolvingPendingPersistedChat =
		currentChatId !== null && resolvingPersistedChatIds.has(currentChatId);
	const selectedProjectRoute = resolveCollectionRoute({
		currentView,
		expectedView: "project",
		// Route resolution is pure render derivation from URL state, not delayed event work.
		id: currentProjectIdString,
		items: projects,
		matches: (project, id) => project._id === id,
		missingWhenIdNull: true,
	});
	const selectedProject =
		selectedProjectRoute.status === "ready" ? selectedProjectRoute.value : null;
	const currentNoteRoute =
		currentView !== "note"
			? ({ status: "inactive" } as const)
			: hasInvalidCurrentNoteRoute || hasMissingCurrentNote
				? ({ status: "missing" } as const)
				: isResolvingCurrentNote
					? ({ status: "resolving" } as const)
					: ({ status: "ready", value: resolvedSelectedNote ?? null } as const);
	const applicationView = resolveApplicationView({
		chat: isResolvingPendingPersistedChat
			? { status: "ready", value: null }
			: currentChatRoute,
		note: currentNoteRoute,
		project: selectedProjectRoute,
		view: currentView,
	});
	const resolvedCurrentView = applicationView.view;
	const isResolvingResourceRoute = applicationView.isResolving;

	React.useEffect(() => {
		let isCancelled = false;

		const syncDesktopWorkspacePreferences = async () => {
			await setDesktopActiveWorkspaceId(resolvedActiveWorkspaceId);

			if (isCancelled) {
				return;
			}

			await setDesktopActiveWorkspaceNotificationPreferences({
				workspaceId: resolvedActiveWorkspaceId,
				notifyForScheduledMeetings:
					notificationPreferences?.notifyForScheduledMeetings ?? false,
				notifyForAutoDetectedMeetings:
					notificationPreferences?.notifyForAutoDetectedMeetings ?? true,
			});
		};

		void syncDesktopWorkspacePreferences();

		return () => {
			isCancelled = true;
		};
	}, [
		notificationPreferences?.notifyForAutoDetectedMeetings,
		notificationPreferences?.notifyForScheduledMeetings,
		resolvedActiveWorkspaceId,
	]);

	const handleWorkspaceCreate = React.useCallback(
		async (input: { name: string }) => {
			const workspace = await createWorkspace(input);
			setActiveWorkspaceId(workspace._id);
			navigateView("home");
			return workspace;
		},
		[createWorkspace, navigateView],
	);
	const handleWorkspaceSelect = React.useCallback(
		(workspaceId: Id<"workspaces">) => {
			if (workspaceId === resolvedActiveWorkspaceId) {
				return;
			}

			setActiveWorkspaceId(() => workspaceId);
			navigateView("home");
		},
		[navigateView, resolvedActiveWorkspaceId],
	);
	const previousResolvedWorkspaceIdRef = React.useRef(
		resolvedActiveWorkspaceId,
	);
	React.useEffect(() => {
		const previousWorkspaceId = previousResolvedWorkspaceIdRef.current;
		previousResolvedWorkspaceIdRef.current = resolvedActiveWorkspaceId;

		if (
			previousWorkspaceId &&
			resolvedActiveWorkspaceId &&
			previousWorkspaceId !== resolvedActiveWorkspaceId &&
			currentView !== "home"
		) {
			navigateView("home");
		}
	}, [currentView, navigateView, resolvedActiveWorkspaceId]);

	React.useEffect(() => {
		void getDesktopMeta()
			.then((meta) => {
				if (meta) {
					setIsDesktopMac(meta.platform === "darwin");
				}
			})
			.catch(() => {
				setIsDesktopMac(false);
			});
	}, []);

	const openChatLanding = React.useCallback(
		(
			options:
				| { mode: "preserve-draft" }
				| { mode: "fresh"; plugin?: ChatPluginSelection },
		) => {
			const freshComposerId =
				options.mode === "fresh" ? crypto.randomUUID() : null;
			const pluginPrefill =
				freshComposerId && options.mode === "fresh" && options.plugin
					? { ...options.plugin, composerId: freshComposerId }
					: null;
			React.startTransition(() => {
				navigateChat(null);
				setAutomationDialogOpen(false);
				setEditingAutomationId(null);
				setCurrentNoteEditorActions(null);
				setCurrentNoteCommentsOpener(null);
				if (freshComposerId) {
					setDraftChatComposerId(freshComposerId);
					setChatPluginPrefill(pluginPrefill);
				}
			});
		},
		[navigateChat, setCurrentNoteEditorActions],
	);

	const openFreshChat = React.useCallback(() => {
		openChatLanding({ mode: "fresh" });
	}, [openChatLanding]);

	const openDraftChat = React.useCallback(() => {
		openChatLanding({ mode: "preserve-draft" });
	}, [openChatLanding]);

	const handleStartChatWithPlugin = React.useCallback(
		(plugin: ChatPluginSelection) => {
			openChatLanding({ mode: "fresh", plugin });
		},
		[openChatLanding],
	);

	const openStoredChat = React.useCallback(
		(chatId: string) => {
			React.startTransition(() => {
				navigateChat(chatId);
			});
		},
		[navigateChat],
	);

	const openProject = React.useCallback(
		(projectId: Id<"projects">) => {
			React.startTransition(() => {
				navigateProject(projectId);
				setAutomationDialogOpen(false);
				setEditingAutomationId(null);
				setCurrentNoteEditorActions(null);
				setCurrentNoteCommentsOpener(null);
			});
		},
		[navigateProject, setCurrentNoteEditorActions],
	);

	const editingAutomation = React.useMemo(
		() =>
			editingAutomationId
				? ((automations ?? []).find(
						(automation) => automation.id === editingAutomationId,
					) ?? null)
				: null,
		[automations, editingAutomationId],
	);
	const automationChatIds = React.useMemo(
		() => new Set((automations ?? []).map((automation) => automation.chatId)),
		[automations],
	);
	const currentChatHasAutomation = currentChatId
		? automationChatIds.has(currentChatId)
		: false;
	const automationActions = useAutomationActions({
		openChat: openStoredChat,
		workspaceId: resolvedActiveWorkspaceId,
	});

	const handleAutomationDialogOpenChange = React.useCallback(
		(open: boolean) => {
			setAutomationDialogOpen(() => open);
			if (!open) {
				setEditingAutomationId(null);
				setAutomationChatId(null);
			}
		},
		[],
	);

	const handleCreateAutomationOpen = React.useCallback(() => {
		setEditingAutomationId(null);
		setAutomationChatId(null);
		setAutomationDialogOpen(true);
	}, []);

	const handleCreateChatAutomationOpen = React.useCallback((chatId: string) => {
		setEditingAutomationId(null);
		setAutomationChatId(() => chatId);
		setAutomationDialogOpen(true);
	}, []);

	const handleEditAutomationOpen = React.useCallback(
		(automationId: Id<"automations">) => {
			setAutomationChatId(null);
			setEditingAutomationId(() => automationId);
			setAutomationDialogOpen(true);
		},
		[],
	);

	const handleAutomationSave = React.useCallback(
		async (automation: AutomationDraft) => {
			const saved = await automationActions.saveAutomation({
				automation,
				automationChatId,
				editingAutomationId,
			});
			if (saved) {
				setAutomationDialogOpen(false);
				setEditingAutomationId(null);
				setAutomationChatId(null);
			}
		},
		[automationActions, automationChatId, editingAutomationId],
	);

	const handleOpenAutomation = React.useCallback(
		(automation: AutomationListItem) => {
			openStoredChat(automation.chatId);
		},
		[openStoredChat],
	);

	const handleRunAutomationNow = React.useCallback(
		async (automationId: Id<"automations">) => {
			await automationActions.runAutomationNow(automationId);
		},
		[automationActions],
	);

	const handleToggleAutomationPaused = React.useCallback(
		async (automationId: Id<"automations">) => {
			await automationActions.toggleAutomationPaused(automationId);
		},
		[automationActions],
	);

	const handleDisableEditingAutomation = React.useCallback(async () => {
		const paused = await automationActions.pauseAutomation(
			editingAutomation ?? null,
		);
		if (paused) {
			setAutomationDialogOpen(false);
			setEditingAutomationId(null);
			setAutomationChatId(null);
		}
	}, [automationActions, editingAutomation]);

	const handleDeleteAutomation = React.useCallback(
		async (automationId: Id<"automations">) => {
			await automationActions.deleteAutomation(automationId);
		},
		[automationActions],
	);

	const handleViewChange = React.useCallback(
		(view: AppView) => {
			if (view === "chat") {
				openDraftChat();
				return;
			}

			navigateView(view);
			setAutomationDialogOpen(false);
			setEditingAutomationId(null);
			setCurrentNoteEditorActions(null);
			setCurrentNoteCommentsOpener(null);
		},
		[navigateView, openDraftChat, setCurrentNoteEditorActions],
	);

	const handleInboxOpenChange = React.useCallback(
		(open: boolean) => {
			setNavigationInboxOpen(open);
		},
		[setNavigationInboxOpen],
	);

	const openNote = React.useCallback(
		(
			noteId: Id<"notes">,
			options?: {
				autoStartCapture?: boolean;
				captureRequestId?: string | null;
				scheduledAutoStartAt?: string | null;
				stopCaptureWhenMeetingEnds?: boolean;
			},
		) => {
			const captureRequestId = getNoteCaptureRequestIdForAutoStart({
				autoStartCapture: options?.autoStartCapture,
				captureRequestId: options?.captureRequestId,
			});
			prepareNoteNavigation(noteId, () => {
				navigateNote(noteId, {
					autoStartCapture: options?.autoStartCapture,
					captureRequestId,
					scheduledAutoStartAt: options?.scheduledAutoStartAt,
					stopCaptureWhenMeetingEnds: options?.stopCaptureWhenMeetingEnds,
				});
				setCurrentNoteEditorActions(null);
				setCurrentNoteCommentsOpener(null);
			});
		},
		[navigateNote, prepareNoteNavigation, setCurrentNoteEditorActions],
	);

	const handleCreateNote = React.useCallback(
		(options: {
			autoStartCapture?: boolean;
			calendarEvent?: UpcomingCalendarEvent | null;
			captureRequestId?: string | null;
			projectId: Id<"projects"> | null;
			stopCaptureWhenMeetingEnds?: boolean;
		}) => {
			if (creatingNoteRef.current) {
				return;
			}

			creatingNoteRef.current = true;
			const shouldStartCapture = options.autoStartCapture === true;
			const captureRequestId = getNoteCaptureRequestIdForAutoStart({
				autoStartCapture: shouldStartCapture,
				captureRequestId: options.captureRequestId,
			});
			const shouldStopCaptureWhenMeetingEnds =
				options.stopCaptureWhenMeetingEnds === true;
			const calendarEvent = options.calendarEvent ?? null;
			const projectId = options.projectId;
			const scheduledAutoStartAt =
				!shouldStartCapture && calendarEvent && shouldStopCaptureWhenMeetingEnds
					? calendarEvent.startAt
					: null;

			if (!resolvedActiveWorkspaceId) {
				creatingNoteRef.current = false;
				return;
			}

			const createNotePromise = calendarEvent
				? createNoteFromCalendarEvent({
						workspaceId: resolvedActiveWorkspaceId,
						calendarEvent,
						content: buildCalendarEventNoteDocument({
							currentDate,
							event: calendarEvent,
						}),
						searchableText: buildCalendarEventSearchableText({
							currentDate,
							event: calendarEvent,
						}),
					})
				: createNote({
						workspaceId: resolvedActiveWorkspaceId,
						projectId,
					});

			void createNotePromise
				.then((noteId) => {
					setCurrentNoteTitleOverride({
						noteId,
						title: calendarEvent?.title.trim() || "",
					});
					openNote(noteId, {
						autoStartCapture: shouldStartCapture,
						captureRequestId,
						scheduledAutoStartAt,
						stopCaptureWhenMeetingEnds: shouldStopCaptureWhenMeetingEnds,
					});
				})
				.catch((error) => {
					logError({
						event: "client.error",
						error: error,
						message: "Failed to create note",
					});
				})
				.finally(() => {
					creatingNoteRef.current = false;
				});
		},
		[
			createNote,
			createNoteFromCalendarEvent,
			currentDate,
			openNote,
			resolvedActiveWorkspaceId,
		],
	);

	const handleQuickNote = React.useCallback(() => {
		const captureRequestId = createNoteCaptureRequestId();
		navigateNote(null, {
			autoStartCapture: true,
			captureRequestId,
		});
		setCurrentNoteEditorActions(null);
		setCurrentNoteCommentsOpener(null);
	}, [navigateNote, setCurrentNoteEditorActions]);

	const handleCreateNoteFromChatResponse = React.useCallback(
		async (title: string, content: string) => {
			if (!resolvedActiveWorkspaceId || creatingNoteRef.current) {
				return undefined;
			}

			creatingNoteRef.current = true;
			const nextTitle = title.trim() || "New note";
			const searchableText = content.trim();
			const nextContent = serializeMarkdownToNoteContent(searchableText);

			try {
				const noteId = await saveNote({
					workspaceId: resolvedActiveWorkspaceId,
					title: nextTitle,
					content: nextContent,
					searchableText,
				});
				setCurrentNoteTitleOverride({
					noteId,
					title: nextTitle,
				});
				openNote(noteId);
				return "created" as const;
			} catch (error) {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to create note from chat response",
				});
				return undefined;
			} finally {
				creatingNoteRef.current = false;
			}
		},
		[openNote, resolvedActiveWorkspaceId, saveNote],
	);

	const handleAutoStartNoteCaptureHandled = React.useCallback(() => {
		consumeNoteCaptureIntent(currentNoteId ?? normalizedRouteNoteId ?? null);
	}, [consumeNoteCaptureIntent, currentNoteId, normalizedRouteNoteId]);

	React.useEffect(() => {
		if (
			resolvedCurrentView === "note" &&
			!resolvedCurrentNoteId &&
			currentRouteNoteId === null &&
			!pendingDesktopCalendarEvent.isResolving
		) {
			handleCreateNote({
				autoStartCapture: shouldAutoStartNoteCapture,
				calendarEvent: pendingDesktopCalendarEvent.event,
				captureRequestId: noteCaptureRequestId,
				projectId: null,
				stopCaptureWhenMeetingEnds: shouldStopNoteCaptureWhenMeetingEnds,
			});
			pendingDesktopCalendarEvent.release();
		}
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [
		currentRouteNoteId,
		handleCreateNote,
		noteCaptureRequestId,
		pendingDesktopCalendarEvent,
		resolvedCurrentNoteId,
		resolvedCurrentView,
		shouldAutoStartNoteCapture,
		shouldStopNoteCaptureWhenMeetingEnds,
	]);

	React.useEffect(() => {
		if (
			resolvedCurrentView !== "note" ||
			!resolvedCurrentNoteId ||
			shouldAutoStartNoteCapture ||
			!scheduledAutoStartNoteCaptureAt
		) {
			return;
		}

		const scheduledAt = new Date(scheduledAutoStartNoteCaptureAt).getTime();

		if (Number.isNaN(scheduledAt)) {
			clearScheduledAutoStart();
			return;
		}

		if (scheduledAt <= Date.now()) {
			triggerScheduledAutoStart();
			return;
		}

		const timeoutId = window.setTimeout(() => {
			triggerScheduledAutoStart();
		}, scheduledAt - Date.now());

		return () => window.clearTimeout(timeoutId);
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [
		clearScheduledAutoStart,
		resolvedCurrentNoteId,
		resolvedCurrentView,
		scheduledAutoStartNoteCaptureAt,
		shouldAutoStartNoteCapture,
		triggerScheduledAutoStart,
	]);

	const handleOpenCalendarEventNote = React.useCallback(
		(
			event: UpcomingCalendarEvent,
			options?: {
				autoStartCapture?: boolean;
				stopCaptureWhenMeetingEnds?: boolean;
			},
		) => {
			handleCreateNote({
				autoStartCapture: options?.autoStartCapture,
				calendarEvent: event,
				projectId: null,
				stopCaptureWhenMeetingEnds: options?.stopCaptureWhenMeetingEnds ?? true,
			});
		},
		[handleCreateNote],
	);

	const handleCreateNoteInsideProject = React.useCallback(
		(projectId: Id<"projects">) => {
			handleCreateNote({
				autoStartCapture: true,
				projectId,
			});
		},
		[handleCreateNote],
	);

	const handleSettingsOpenChange = React.useCallback(
		(open: boolean, page: SettingsPage = "Profile") => {
			setNavigationSettingsOpen(open, page);
		},
		[setNavigationSettingsOpen],
	);

	React.useEffect(() => {
		if (typeof window === "undefined" || !isDesktopRuntime()) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				!(event.metaKey || event.ctrlKey) ||
				event.altKey ||
				event.shiftKey ||
				(event.key !== "," && event.code !== "Comma")
			) {
				return;
			}

			event.preventDefault();
			handleSettingsOpenChange(true, "Profile");
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleSettingsOpenChange]);

	React.useEffect(() => {
		if (typeof window === "undefined" || !isDesktopRuntime()) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				!(event.metaKey || event.ctrlKey) ||
				event.altKey ||
				event.shiftKey ||
				!/^[1-9]$/.test(event.key)
			) {
				return;
			}

			const workspace = workspaces[Number(event.key) - 1];
			if (!workspace || workspace._id === resolvedActiveWorkspaceId) {
				return;
			}

			event.preventDefault();
			handleWorkspaceSelect(workspace._id);
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleWorkspaceSelect, resolvedActiveWorkspaceId, workspaces]);

	const handleOpenCalendarSettings = React.useCallback(() => {
		handleSettingsOpenChange(true, "Calendar");
	}, [handleSettingsOpenChange]);

	const handleSignOut = React.useCallback(() => {
		startSignOut(async () => {
			try {
				clearCachedConvexToken();
				await authClient.signOut();
			} catch (error) {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to sign out",
				});
			}
		});
	}, []);

	const handleNoteTrashed = React.useCallback(
		(noteId: Id<"notes">) => {
			if (noteId !== resolvedCurrentNoteId) {
				return;
			}

			setCurrentNoteTitleOverride(null);
			setCurrentNoteEditorActions(null);
			setCurrentNoteCommentsOpener(null);
			handleViewChange("home");
		},
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
		[handleViewChange, resolvedCurrentNoteId, setCurrentNoteEditorActions],
	);
	const handlePrefetchChat = React.useCallback(
		(chatId: string) => {
			if (!resolvedActiveWorkspaceId) {
				return;
			}

			void prefetchChatMessagesSnapshot({
				chatId,
				convex,
				workspaceId: resolvedActiveWorkspaceId,
			}).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to prefetch chat messages snapshot",
				});
			});
		},
		[convex, resolvedActiveWorkspaceId],
	);
	const handleOpenChat = React.useCallback(
		(chatId: string) => {
			handlePrefetchChat(chatId);
			openStoredChat(chatId);
		},
		[handlePrefetchChat, openStoredChat],
	);

	const handleNewChat = React.useCallback(() => {
		openFreshChat();
	}, [openFreshChat]);

	const handleChatPersisted = React.useCallback(
		(chatId: string) => {
			addPendingPersistedChatRouteId(chatId);
			setChatPluginPrefill((prefill) =>
				consumeChatPluginPrefill({ chatId, prefill }),
			);

			if (currentChatId !== chatId) {
				setDraftChatComposerId(crypto.randomUUID());
			}
			navigateChat(chatId, "replace");
		},
		[addPendingPersistedChatRouteId, currentChatId, navigateChat],
	);
	const handleChatRemoved = React.useCallback(
		(chatId: string) => {
			removePendingPersistedChatRouteId(chatId);

			if (currentChatId !== chatId) {
				return;
			}

			const nextChatId = crypto.randomUUID();
			setDraftChatComposerId(nextChatId);
			navigateChat(null, "replace");
		},
		[currentChatId, navigateChat, removePendingPersistedChatRouteId],
	);
	const currentChat =
		currentChatRoute.status === "ready" ? currentChatRoute.value : null;
	const currentChatTitle = currentChat?.title || "New chat";
	const automationChatTitle = automationChatId
		? (chats?.find((chat) => getChatId(chat) === automationChatId)?.title ?? "")
		: "";
	const currentChatNoteId = currentChat?.noteId ?? null;
	const isSharedNote =
		resolvedCurrentView === "note" &&
		(resolvedSelectedNote?.visibility === "public" ||
			sharedNotes?.some((note) => note._id === resolvedCurrentNoteId) === true);

	return {
		accountId: session?.user?.id ?? null,
		activeWorkspaceId: resolvedActiveWorkspaceId,
		breadcrumbDetailLabel:
			isResolvingResourceRoute || resolvedCurrentView === "notFound"
				? null
				: resolvedCurrentView === "note" && !isResolvingCurrentNote
					? getNoteDisplayTitle(currentNoteTitle)
					: resolvedCurrentView === "chat" && currentChatId
						? currentChatTitle
						: resolvedCurrentView === "project"
							? (selectedProject?.name ?? null)
							: null,
		breadcrumbSectionLabel: getBreadcrumbSectionLabel({
			currentView: resolvedCurrentView,
			isSharedNote,
		}),
		chats,
		activeStreamingChatIds,
		chatComposerId,
		chatPluginPrefill,
		currentChat,
		currentChatId,
		currentChatNoteId,
		currentChatTitle,
		currentDate,
		currentDayOfMonth,
		currentMonthLabel,
		currentNoteCommentsOpener,
		currentNoteEditorActions,
		currentNoteId: isResolvingCurrentNote ? null : resolvedCurrentNoteId,
		noteCaptureRequestId,
		currentNoteTemplateSlug: resolvedSelectedNote?.templateSlug ?? null,
		currentNoteTitle,
		currentView: resolvedCurrentView,
		currentWeekdayLabel,
		isResolvingResourceRoute,
		handleAutoStartNoteCaptureHandled,
		handleBreadcrumbSectionClick: () => {
			if (resolvedCurrentView === "notFound") {
				handleViewChange("home");
				return;
			}

			if (resolvedCurrentView === "chat") {
				openFreshChat();
				return;
			}

			if (resolvedCurrentView === "automation") {
				handleViewChange("automation");
				return;
			}

			if (resolvedCurrentView === "calendar") {
				handleViewChange("calendar");
				return;
			}

			if (resolvedCurrentView === "project") {
				handleViewChange("home");
				return;
			}

			handleViewChange(
				resolvedCurrentView === "shared" || isSharedNote ? "shared" : "home",
			);
		},
		handleChatPersisted,
		handleChatRemoved,
		handleCreateNote,
		handleCreateNoteInsideProject,
		handleCreateNoteFromChatResponse,
		handleCreateAutomationOpen,
		handleCreateChatAutomationOpen,
		handleEditAutomationOpen,
		handleDisableEditingAutomation,
		handleOpenAutomation,
		handleInboxOpenChange,
		handleNewChat,
		handleNoteTrashed,
		handleDeleteAutomation,
		handleOpenCalendarEventNote,
		handleOpenCalendarSettings,
		handleOpenChat,
		openProject,
		handlePrefetchChat,
		handlePrefetchNote,
		handleQuickNote,
		handleRunAutomationNow,
		handleSettingsOpenChange,
		handleSignOut,
		handleStartChatWithPlugin,
		handleToggleAutomationPaused,
		handleViewChange,
		handleWorkspaceCreate,
		inboxOpen,
		automationDialogOpen,
		automations,
		automationChatTitle,
		currentChatHasAutomation,
		editingAutomation,
		isDesktopMac,
		isResolvingCurrentNoteRoute: isResolvingCurrentNote,
		isSharedNote,
		isSigningOut,
		notes,
		projects,
		selectedProject,
		openNote,
		selectedNote: resolvedSelectedNote,
		settingsOpen,
		settingsPage,
		setActiveWorkspaceId: handleWorkspaceSelect,
		handleAutomationDialogOpenChange,
		setCurrentNoteCommentsOpener,
		setCurrentNoteEditorActions,
		noteEditorActionsStore,
		setCurrentNoteTitle,
		sharedNotes,
		shouldAutoStartNoteCapture,
		shouldStopNoteCaptureWhenMeetingEnds,
		handleAutomationSave,
		upcomingCalendar,
		user,
		workspaces,
	};
};

type AppShellController = ReturnType<typeof useAppShellState>;

type AppShellHeaderProps = {
	isDesktopMac: boolean;
	inboxOpen: boolean;
	breadcrumbSectionLabel: string;
	breadcrumbDetailLabel: string | null;
	onBreadcrumbSectionClick: () => void;
	currentView: AppView;
	currentChatId: string | null;
	currentChat: Doc<"chats"> | null;
	currentChatTitle: string;
	currentChatNoteId: Id<"notes"> | null;
	currentChatHasAutomation: boolean;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle: string;
	currentProject: Doc<"projects"> | null;
	onProjectAppearancePreviewChange: (
		preview: ProjectAppearancePreview | null,
	) => void;
	currentNoteTemplateSlug: string | null;
	currentNoteEditorActions: NoteEditorActions | null;
	currentNoteCommentsOpener: (() => void) | null;
	onCreateNote: () => void;
	onNoteTitleChange: (title: string) => void;
	onNoteTrashed: (noteId: Id<"notes">) => void;
	onChatTrashed: (chatId: string) => void;
	onNewChat: () => void;
	onNewAutomation: () => void;
	onNewChatAutomation: (chatId: string) => void;
};

function AppShellHeader({
	isDesktopMac,
	inboxOpen,
	breadcrumbSectionLabel,
	breadcrumbDetailLabel,
	onBreadcrumbSectionClick,
	currentView,
	currentChatId,
	currentChat,
	currentChatTitle,
	currentChatNoteId,
	currentChatHasAutomation,
	currentNoteId,
	currentNoteTitle,
	currentProject,
	onProjectAppearancePreviewChange,
	currentNoteTemplateSlug,
	currentNoteEditorActions,
	currentNoteCommentsOpener,
	onCreateNote,
	onNoteTitleChange,
	onNoteTrashed,
	onChatTrashed,
	onNewChat,
	onNewAutomation,
	onNewChatAutomation,
}: AppShellHeaderProps) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const noteTemplates = useQuery(
		api.templates.list,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const { isMobile, state: sidebarState } = useSidebarShell();
	const { leftInsetPanelWidth, leftOverlayPanelWidth } = useDockedPanelWidths();
	const {
		editor: breadcrumbChatTitleEditor,
		openEditor: openBreadcrumbTitleEditor,
	} = useBreadcrumbChatTitleEditor({
		chatId: currentView === "chat" ? currentChatId : null,
		noteId: currentChatNoteId,
		title: currentChatTitle,
	});
	let breadcrumbTitleEditor: React.ReactNode = null;
	if (breadcrumbDetailLabel) {
		switch (currentView) {
			case "project":
				breadcrumbTitleEditor = currentProject ? (
					<ProjectBreadcrumbTitleEditor
						detailLabel={breadcrumbDetailLabel}
						isDesktopMac={isDesktopMac}
						onAppearancePreviewChange={onProjectAppearancePreviewChange}
						project={currentProject}
						workspaceId={activeWorkspaceId}
					/>
				) : null;
				break;
			case "note":
				breadcrumbTitleEditor = currentNoteId ? (
					<NoteBreadcrumbTitleEditor
						detailLabel={breadcrumbDetailLabel}
						isDesktopMac={isDesktopMac}
						noteId={currentNoteId}
						onPreviewChange={onNoteTitleChange}
						title={currentNoteTitle}
						workspaceId={activeWorkspaceId}
					/>
				) : null;
				break;
			case "chat":
				breadcrumbTitleEditor = breadcrumbChatTitleEditor ? (
					<ChatBreadcrumbTitleEditor
						detailLabel={breadcrumbDetailLabel}
						editor={breadcrumbChatTitleEditor}
						isDesktopMac={isDesktopMac}
					/>
				) : null;
				break;
		}
	}

	return (
		<header
			data-desktop-nonselectable
			className={cn(
				"sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between bg-background/95 px-4 backdrop-blur transition-[width,height] ease-linear md:px-6",
				isDesktopMac && DESKTOP_MAIN_HEADER_CLASS,
			)}
		>
			{isDesktopMac ? (
				<div
					aria-hidden="true"
					data-app-region="drag"
					className="absolute inset-y-0 right-0"
					style={{
						left:
							!inboxOpen || leftInsetPanelWidth
								? 0
								: (leftOverlayPanelWidth ?? DESKTOP_INBOX_PANEL_WIDTH),
					}}
				/>
			) : null}
			<div
				className={cn(
					"relative z-10 flex min-w-0 flex-1 items-center gap-2 pr-4",
					isDesktopMac && DESKTOP_MAIN_HEADER_CONTENT_CLASS,
					isDesktopMac && isMobile && DESKTOP_MAIN_HEADER_LEADING_CLASS,
					isDesktopMac && isMobile && "mt-1",
					isDesktopMac &&
						sidebarState === "collapsed" &&
						DESKTOP_MAIN_HEADER_LEADING_CLASS,
				)}
			>
				<Tooltip>
					<TooltipTrigger asChild>
						<SidebarTrigger
							data-app-region={isDesktopMac ? "no-drag" : undefined}
						/>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						<div className="flex items-center gap-2">
							<span>Toggle sidebar</span>
							<Kbd className="border border-border/60 bg-muted px-1.5 font-mono text-[10px] opacity-100">
								<span className="text-xs">⌘</span>
								<span>B</span>
							</Kbd>
						</div>
					</TooltipContent>
				</Tooltip>
				<Separator
					orientation="vertical"
					className="mr-2 data-[orientation=vertical]:h-4"
				/>
				<AppShellBreadcrumbs
					breadcrumbSectionLabel={breadcrumbSectionLabel}
					breadcrumbDetailLabel={breadcrumbDetailLabel}
					isDesktopMac={isDesktopMac}
					onBreadcrumbSectionClick={onBreadcrumbSectionClick}
					titleEditor={breadcrumbTitleEditor}
					showAutomationIcon={
						currentView === "chat" && currentChatHasAutomation
					}
					onAutomationIconClick={
						currentView === "chat" && currentChatId
							? () => onNewChatAutomation(currentChatId)
							: undefined
					}
				/>
			</div>
			<div
				className={cn(
					"relative z-10 ml-auto shrink-0",
					isDesktopMac && DESKTOP_MAIN_HEADER_CONTENT_CLASS,
					isDesktopMac && isMobile && "mt-1",
				)}
			>
				<AppShellHeaderActions
					currentView={currentView}
					currentNoteId={currentNoteId}
					currentNoteTitle={currentNoteTitle}
					currentNoteTemplateSlug={currentNoteTemplateSlug}
					noteTemplates={noteTemplates}
					currentNoteEditorActions={currentNoteEditorActions}
					currentNoteCommentsOpener={currentNoteCommentsOpener}
					isDesktopMac={isDesktopMac}
					currentChatId={currentChatId}
					currentChat={currentChat}
					currentChatHasAutomation={currentChatHasAutomation}
					onOpenChatTitleEditor={openBreadcrumbTitleEditor}
					onCreateNote={onCreateNote}
					onNoteTrashed={onNoteTrashed}
					onChatTrashed={onChatTrashed}
					onNewChat={onNewChat}
					onNewAutomation={onNewAutomation}
					onNewChatAutomation={onNewChatAutomation}
				/>
			</div>
		</header>
	);
}

function AppShellBreadcrumbs({
	breadcrumbSectionLabel,
	breadcrumbDetailLabel,
	isDesktopMac,
	onBreadcrumbSectionClick,
	titleEditor,
	showAutomationIcon,
	onAutomationIconClick,
}: {
	breadcrumbSectionLabel: string;
	breadcrumbDetailLabel: string | null;
	isDesktopMac: boolean;
	onBreadcrumbSectionClick: () => void;
	titleEditor: React.ReactNode;
	showAutomationIcon?: boolean;
	onAutomationIconClick?: () => void;
}) {
	const automationIconButton = showAutomationIcon ? (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					data-app-region={isDesktopMac ? "no-drag" : undefined}
					className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-hidden transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
					aria-label="Edit automation"
					onClick={onAutomationIconClick}
				>
					<Clock className="size-4" />
				</button>
			</TooltipTrigger>
			<TooltipContent>Edit automation</TooltipContent>
		</Tooltip>
	) : null;

	return (
		<Breadcrumb className="min-w-0 flex-1">
			<BreadcrumbList className="min-w-0 flex-nowrap overflow-hidden">
				{breadcrumbDetailLabel ? (
					<>
						<BreadcrumbItem className="hidden shrink-0 md:inline-flex">
							<BreadcrumbLink asChild>
								<button
									type="button"
									data-app-region={isDesktopMac ? "no-drag" : undefined}
									className="cursor-pointer truncate"
									onClick={onBreadcrumbSectionClick}
								>
									{breadcrumbSectionLabel}
								</button>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator className="hidden shrink-0 md:block" />
						<BreadcrumbItem className="min-w-0 flex-1 overflow-hidden">
							{titleEditor ? (
								<div className="flex min-w-0 items-center gap-2">
									{titleEditor}
									{automationIconButton}
								</div>
							) : (
								<BreadcrumbPage className="flex min-w-0 items-center gap-2">
									<span className="truncate">{breadcrumbDetailLabel}</span>
									{automationIconButton}
								</BreadcrumbPage>
							)}
						</BreadcrumbItem>
					</>
				) : (
					<BreadcrumbItem className="min-w-0 flex-1 overflow-hidden">
						<BreadcrumbPage className="block truncate">
							{breadcrumbSectionLabel}
						</BreadcrumbPage>
					</BreadcrumbItem>
				)}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

function AppShellHeaderActions({
	currentView,
	currentNoteId,
	currentNoteTitle,
	currentNoteTemplateSlug,
	noteTemplates,
	currentNoteEditorActions,
	currentNoteCommentsOpener,
	isDesktopMac,
	currentChatId,
	currentChat,
	currentChatHasAutomation,
	onOpenChatTitleEditor,
	onCreateNote,
	onNoteTrashed,
	onChatTrashed,
	onNewChat,
	onNewAutomation,
	onNewChatAutomation,
}: Pick<
	AppShellHeaderProps,
	| "currentView"
	| "currentNoteId"
	| "currentNoteTitle"
	| "currentNoteTemplateSlug"
	| "currentNoteEditorActions"
	| "currentNoteCommentsOpener"
	| "isDesktopMac"
	| "currentChatId"
	| "currentChat"
	| "currentChatHasAutomation"
	| "onCreateNote"
	| "onNoteTrashed"
	| "onChatTrashed"
	| "onNewChat"
	| "onNewAutomation"
	| "onNewChatAutomation"
> & {
	onOpenChatTitleEditor: () => void;
	noteTemplates: NoteTemplate[] | undefined;
}) {
	if (currentView === "home") {
		return (
			<Button
				variant="outline"
				data-app-region={isDesktopMac ? "no-drag" : undefined}
				onClick={onCreateNote}
			>
				<Plus />
				Quick note
			</Button>
		);
	}

	if (currentView === "calendar") {
		return (
			<Button
				variant="outline"
				data-app-region={isDesktopMac ? "no-drag" : undefined}
				onClick={() => window.dispatchEvent(new Event(OPEN_NEW_CALENDAR_EVENT))}
			>
				<Plus data-icon="inline-start" />
				New event
			</Button>
		);
	}

	if (currentView === "chat") {
		return (
			<ChatHeaderActions
				chatId={currentChatId}
				chat={currentChat}
				hasAutomation={currentChatHasAutomation}
				isDesktopMac={isDesktopMac}
				onNewChat={onNewChat}
				onRenameChat={onOpenChatTitleEditor}
				onChatTrashed={onChatTrashed}
				onAddAutomation={onNewChatAutomation}
			/>
		);
	}

	if (currentView === "automation") {
		return (
			<Button
				variant="outline"
				data-app-region={isDesktopMac ? "no-drag" : undefined}
				onClick={onNewAutomation}
			>
				<Plus />
				Add automation
			</Button>
		);
	}

	if (currentView === "inbox") {
		return null;
	}

	if (currentView !== "note" || !currentNoteId) {
		return null;
	}

	return (
		<div
			className="flex items-center gap-2"
			data-app-region={isDesktopMac ? "no-drag" : undefined}
		>
			{currentNoteEditorActions?.canShowTemplateSelect ? (
				<NoteTemplateSelect
					key={currentNoteId}
					disabled={!currentNoteEditorActions}
					selectedSlug={currentNoteTemplateSlug}
					templates={noteTemplates}
					onTemplateSelect={async (template) =>
						(await currentNoteEditorActions?.applyTemplate(template)) ?? false
					}
				/>
			) : null}
			<NoteStarButton noteId={currentNoteId} className="size-7" />
			<NoteCommentsButton
				noteId={currentNoteId}
				isDesktopMac={isDesktopMac}
				onOpen={currentNoteCommentsOpener}
			/>
			<NoteHeaderActionsMenu
				noteId={currentNoteId}
				noteTitle={currentNoteTitle}
				noteEditorActions={currentNoteEditorActions}
				onNoteTrashed={onNoteTrashed}
			/>
		</div>
	);
}

function ChatHeaderActions({
	chatId,
	chat,
	isDesktopMac,
	onNewChat,
	onRenameChat,
	onChatTrashed,
	onAddAutomation,
	hasAutomation,
}: {
	chatId: string | null;
	chat: Doc<"chats"> | null;
	isDesktopMac: boolean;
	onNewChat: () => void;
	onRenameChat: () => void;
	onChatTrashed: (chatId: string) => void;
	onAddAutomation: (chatId: string) => void;
	hasAutomation: boolean;
}) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const [confirmTrashOpen, setConfirmTrashOpen] = React.useState(false);
	const [isUpdatingStar, setIsUpdatingStar] = React.useState(false);
	const [isMovingToTrash, setIsMovingToTrash] = React.useState(false);
	const isStarred = chat?.isStarred ?? false;
	const toggleStar = useMutation(api.chats.toggleStar).withOptimisticUpdate(
		(localStore, args) => {
			optimisticPatchChat(
				localStore,
				args.workspaceId,
				args.chatId,
				(currentChat) => ({
					...currentChat,
					isStarred: !(currentChat.isStarred ?? false),
				}),
				chat?.noteId,
			);
		},
	);
	const moveChatToTrash = useMutation(api.chats.moveToTrash);

	const handleToggleStar = React.useCallback(() => {
		if (!activeWorkspaceId || !chatId || isUpdatingStar) {
			return;
		}

		setIsUpdatingStar(true);

		void toggleStar({ workspaceId: activeWorkspaceId, chatId })
			.then((result) => {
				toast.success(result.isStarred ? "Chat starred" : "Chat unstarred");
			})
			.catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to update chat star",
				});
				toast.error("Failed to update chat star");
			})
			.finally(() => {
				setIsUpdatingStar(false);
			});
	}, [activeWorkspaceId, chatId, isUpdatingStar, toggleStar]);

	const handleConfirmTrash = React.useCallback(() => {
		if (!activeWorkspaceId || !chatId || isMovingToTrash) {
			return;
		}

		setIsMovingToTrash(true);

		void moveChatToTrash({ workspaceId: activeWorkspaceId, chatId })
			.then(() => {
				onChatTrashed(chatId);
				setConfirmTrashOpen(false);
				toast.success("Chat moved to trash");
			})
			.catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to move chat to trash",
				});
				toast.error("Failed to move chat to trash");
			})
			.finally(() => {
				setIsMovingToTrash(false);
			});
	}, [
		activeWorkspaceId,
		chatId,
		isMovingToTrash,
		moveChatToTrash,
		onChatTrashed,
	]);

	if (!chatId) {
		return (
			<Button
				variant="outline"
				data-app-region={isDesktopMac ? "no-drag" : undefined}
				onClick={onNewChat}
			>
				<Plus />
				New chat
			</Button>
		);
	}

	return (
		<div
			className="flex items-center gap-1"
			data-app-region={isDesktopMac ? "no-drag" : undefined}
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="New chat"
						onClick={onNewChat}
					>
						<Plus className="size-4" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>New chat</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Open summary"
						onClick={() => {
							window.dispatchEvent(new Event(OPEN_CHAT_SUMMARY_EVENT));
						}}
					>
						<TextSearch className="size-4" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Open summary</TooltipContent>
			</Tooltip>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label="More actions"
								className="text-muted-foreground hover:text-foreground"
							>
								<MoreHorizontal className="size-4" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent>More actions</TooltipContent>
				</Tooltip>
				<DropdownMenuContent
					align="end"
					className="w-44 overflow-hidden rounded-lg p-1"
				>
					<DropdownMenuItem
						className="cursor-pointer"
						disabled={!chatId}
						onSelect={onRenameChat}
					>
						<Pencil />
						Rename
					</DropdownMenuItem>
					<DropdownMenuItem
						className="cursor-pointer"
						disabled={!chatId || !activeWorkspaceId || isUpdatingStar}
						onSelect={handleToggleStar}
					>
						{isStarred ? <StarOff /> : <Star />}
						{isStarred ? "Unstar" : "Star"}
					</DropdownMenuItem>
					<DropdownMenuItem
						className="cursor-pointer"
						disabled={!chatId || !activeWorkspaceId}
						onSelect={() => {
							if (chatId) {
								onAddAutomation(chatId);
							}
						}}
					>
						<Clock />
						{hasAutomation ? "Edit automation" : "Add automation"}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						className="cursor-pointer"
						disabled={!chatId}
						onSelect={() => setConfirmTrashOpen(true)}
					>
						<Trash2 />
						Move to trash
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<AlertDialog open={confirmTrashOpen} onOpenChange={setConfirmTrashOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Move chat to trash?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the chat from the list. You can restore it later from
							Trash.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isMovingToTrash}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive dark:text-red-500 dark:hover:bg-destructive/25"
							onClick={handleConfirmTrash}
							disabled={isMovingToTrash}
						>
							{isMovingToTrash ? "Moving..." : "Move to trash"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function createAppShellContentView({
	controller,
	handleGoHome,
	handleNoteCommentsOpenChange,
	handleOpenConnectionsSettings,
}: {
	controller: AppShellController;
	handleGoHome: () => void;
	handleNoteCommentsOpenChange: (opener: (() => void) | null) => void;
	handleOpenConnectionsSettings: () => void;
}): AppShellContentView {
	if (controller.isResolvingResourceRoute) {
		return {
			kind: "resolving",
		};
	}

	if (controller.currentView === "notFound") {
		return {
			kind: "notFound",
			onGoHome: handleGoHome,
		};
	}

	if (controller.currentView === "home") {
		return {
			kind: "home",
			isDesktopMac: controller.isDesktopMac,
			currentDate: controller.currentDate,
			currentDayOfMonth: controller.currentDayOfMonth,
			currentMonthLabel: controller.currentMonthLabel,
			currentWeekdayLabel: controller.currentWeekdayLabel,
			upcomingCalendar: controller.upcomingCalendar,
			notes: controller.notes,
			currentNoteId: controller.currentNoteId,
			currentNoteTitle: controller.currentNoteTitle,
			user: controller.user,
			onOpenNote: controller.openNote,
			onNoteTrashed: controller.handleNoteTrashed,
			onCreateNote: controller.handleQuickNote,
			onOpenCalendarEventNote: controller.handleOpenCalendarEventNote,
			onOpenCalendarSettings: controller.handleOpenCalendarSettings,
		};
	}

	if (controller.currentView === "calendar") {
		return {
			kind: "calendar",
			accountId: controller.accountId,
			isDesktopMac: controller.isDesktopMac,
			onOpenCalendarEventNote: (event) =>
				controller.handleOpenCalendarEventNote(event, {
					stopCaptureWhenMeetingEnds: false,
				}),
			onOpenCalendarSettings: controller.handleOpenCalendarSettings,
		};
	}

	if (controller.currentView === "shared") {
		return {
			kind: "shared",
			isDesktopMac: controller.isDesktopMac,
			sharedNotes: controller.sharedNotes,
			currentNoteId: controller.currentNoteId,
			currentNoteTitle: controller.currentNoteTitle,
			user: controller.user,
			onOpenNote: controller.openNote,
			onNoteTrashed: controller.handleNoteTrashed,
		};
	}

	if (controller.currentView === "project") {
		const project = controller.selectedProject;
		if (!project) {
			return {
				kind: "notFound",
				onGoHome: handleGoHome,
			};
		}

		return {
			kind: "project",
			isDesktopMac: controller.isDesktopMac,
			project,
			notes: controller.notes,
			currentNoteId: controller.currentNoteId,
			currentNoteTitle: controller.currentNoteTitle,
			user: controller.user,
			onOpenNote: controller.openNote,
			onNoteTrashed: controller.handleNoteTrashed,
			onCreateNote: () => {
				controller.handleCreateNoteInsideProject(project._id);
			},
		};
	}

	if (controller.currentView === "automation") {
		return {
			kind: "automation",
			automations: controller.automations,
			isDesktopMac: controller.isDesktopMac,
			onCreateAutomation: controller.handleCreateAutomationOpen,
			onDeleteAutomation: controller.handleDeleteAutomation,
			onEditAutomation: controller.handleEditAutomationOpen,
			onOpenAutomation: controller.handleOpenAutomation,
			onRunAutomationNow: controller.handleRunAutomationNow,
			onToggleAutomationPaused: controller.handleToggleAutomationPaused,
		};
	}

	if (controller.currentView === "note") {
		return {
			kind: "note",
			currentNoteId: controller.currentNoteId,
			currentNoteTitle: controller.currentNoteTitle,
			noteCaptureRequestId: controller.noteCaptureRequestId,
			selectedNote: controller.selectedNote,
			user: controller.user,
			isDesktopMac: controller.isDesktopMac,
			onAutoStartNoteCaptureHandled:
				controller.handleAutoStartNoteCaptureHandled,
			onNoteCommentsOpenChange: handleNoteCommentsOpenChange,
			noteEditorActionsStore: controller.noteEditorActionsStore,
			onNoteTitleChange: controller.setCurrentNoteTitle,
			shouldAutoStartNoteCapture: controller.shouldAutoStartNoteCapture,
			shouldStopNoteCaptureWhenMeetingEnds:
				controller.shouldStopNoteCaptureWhenMeetingEnds,
		};
	}

	return {
		kind: "chat",
		activeStreamingChatIds: controller.activeStreamingChatIds,
		automations: controller.automations,
		chatComposerId: controller.chatComposerId,
		chatPluginPrefill: controller.chatPluginPrefill,
		chats: controller.chats,
		currentChatId: controller.currentChatId,
		isDesktopMac: controller.isDesktopMac,
		onChatPersisted: controller.handleChatPersisted,
		onChatRemoved: controller.handleChatRemoved,
		onCreateChatAutomation: controller.handleCreateChatAutomationOpen,
		onCreateNoteFromChatResponse: controller.handleCreateNoteFromChatResponse,
		onOpenChat: controller.handleOpenChat,
		onOpenConnectionsSettings: handleOpenConnectionsSettings,
		onPrefetchChat: controller.handlePrefetchChat,
	};
}

export function AuthenticatedAppShell({
	session,
	workspaces,
	initialDesktopMac,
}: {
	session: AuthSession;
	workspaces: Array<WorkspaceRecord>;
	initialDesktopMac: boolean;
}) {
	const controller = useAppShellState({
		session,
		workspaces,
		initialDesktopMac,
	});
	const [projectAppearancePreview, setProjectAppearancePreview] =
		React.useState<ProjectAppearancePreview | null>(null);
	const handleOpenConnectionsSettings = React.useCallback(
		() => controller.handleSettingsOpenChange(true, "Plugins"),
		[controller.handleSettingsOpenChange],
	);
	const handleNoteCommentsOpenChange = React.useCallback(
		(opener: (() => void) | null) => {
			controller.setCurrentNoteCommentsOpener(() => opener);
		},
		[controller.setCurrentNoteCommentsOpener],
	);
	const handleGoHome = React.useCallback(
		() => controller.handleViewChange("home"),
		[controller.handleViewChange],
	);
	const appShellContentView = createAppShellContentView({
		controller,
		handleGoHome,
		handleNoteCommentsOpenChange,
		handleOpenConnectionsSettings,
	});

	return (
		<ActiveWorkspaceProvider workspaceId={controller.activeWorkspaceId}>
			<SidebarProvider className="h-svh overflow-hidden">
				<AppSidebar
					workspaces={controller.workspaces}
					activeWorkspaceId={controller.activeWorkspaceId}
					currentView={controller.currentView}
					inboxOpen={controller.inboxOpen}
					user={controller.user}
					chats={controller.chats}
					activeStreamingChatIds={controller.activeStreamingChatIds}
					automations={controller.automations}
					notes={controller.notes}
					sharedNotes={controller.sharedNotes}
					projectAppearancePreview={projectAppearancePreview}
					onWorkspaceSelect={controller.setActiveWorkspaceId}
					onWorkspaceCreate={controller.handleWorkspaceCreate}
					onViewChange={controller.handleViewChange}
					onInboxOpenChange={controller.handleInboxOpenChange}
					settingsOpen={controller.settingsOpen}
					settingsPage={controller.settingsPage}
					onSettingsOpenChange={controller.handleSettingsOpenChange}
					onStartChatWithPlugin={controller.handleStartChatWithPlugin}
					onSignOut={controller.handleSignOut}
					signingOut={controller.isSigningOut}
					desktopSafeTop={controller.isDesktopMac}
					currentChatId={controller.currentChatId}
					currentChatTitle={controller.currentChatTitle}
					currentNoteId={controller.currentNoteId}
					currentNoteTitle={controller.currentNoteTitle}
					onChatSelect={controller.handleOpenChat}
					onAddAutomation={controller.handleCreateChatAutomationOpen}
					onNotePrefetch={controller.handlePrefetchNote}
					onNoteSelect={controller.openNote}
					onProjectSelect={controller.openProject}
					onNoteTitleChange={controller.setCurrentNoteTitle}
					onNoteTrashed={controller.handleNoteTrashed}
					onCreateNote={controller.handleQuickNote}
					onCreateNoteInsideProject={controller.handleCreateNoteInsideProject}
				/>
				<AppShellInset reserveRightSidebar={controller.currentView === "note"}>
					<AppShellHeader
						isDesktopMac={controller.isDesktopMac}
						inboxOpen={controller.inboxOpen}
						breadcrumbSectionLabel={controller.breadcrumbSectionLabel}
						breadcrumbDetailLabel={controller.breadcrumbDetailLabel}
						onBreadcrumbSectionClick={controller.handleBreadcrumbSectionClick}
						currentView={controller.currentView}
						currentChatId={controller.currentChatId}
						currentChat={controller.currentChat}
						currentChatTitle={controller.currentChatTitle}
						currentChatNoteId={controller.currentChatNoteId}
						currentChatHasAutomation={controller.currentChatHasAutomation}
						currentNoteId={controller.currentNoteId}
						currentNoteTitle={controller.currentNoteTitle}
						currentProject={controller.selectedProject}
						onProjectAppearancePreviewChange={setProjectAppearancePreview}
						currentNoteTemplateSlug={controller.currentNoteTemplateSlug}
						currentNoteEditorActions={controller.currentNoteEditorActions}
						currentNoteCommentsOpener={controller.currentNoteCommentsOpener}
						onCreateNote={controller.handleQuickNote}
						onNoteTitleChange={controller.setCurrentNoteTitle}
						onNoteTrashed={controller.handleNoteTrashed}
						onChatTrashed={controller.handleChatRemoved}
						onNewChat={controller.handleNewChat}
						onNewAutomation={controller.handleCreateAutomationOpen}
						onNewChatAutomation={controller.handleCreateChatAutomationOpen}
					/>
					<AppShellContent view={appShellContentView} />
				</AppShellInset>
				<CreateAutomationDialogEntry
					open={controller.automationDialogOpen}
					onOpenChange={controller.handleAutomationDialogOpenChange}
					onCreateAutomation={controller.handleAutomationSave}
					onDisableAutomation={
						controller.editingAutomation &&
						!controller.editingAutomation.isPaused
							? controller.handleDisableEditingAutomation
							: undefined
					}
					onOpenConnectionsSettings={handleOpenConnectionsSettings}
					initialAutomation={controller.editingAutomation}
					initialTitle={controller.automationChatTitle}
				/>
			</SidebarProvider>
		</ActiveWorkspaceProvider>
	);
}
