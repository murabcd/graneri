import type { AppView } from "@/app/app-types";
import {
	resolveApplicationView,
	resolveCollectionRoute,
} from "@/app/application-navigation-session";
import type { usePaginatedNotes } from "@/hooks/use-paginated-notes";
import { getChatId } from "@/lib/chat";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

type PaginatedNote = NonNullable<
	ReturnType<typeof usePaginatedNotes>["notes"]
>[number];

export const getAppShellWorkspaceQueryArgs = (
	workspaceId: Id<"workspaces"> | null,
	enabled = true,
) => (workspaceId && enabled ? { workspaceId } : ("skip" as const));

export const getAppShellUserPreferencesQueryArgs = (
	isAuthenticated: boolean,
) => (isAuthenticated ? {} : ("skip" as const));

export const getSharedNotes = (notes: PaginatedNote[] | undefined) =>
	notes?.filter((note) => note.visibility === "public");

export const getNormalizedNoteIdQueryArgs = ({
	currentNoteId,
	currentRouteNoteId,
	currentView,
}: {
	currentNoteId: Id<"notes"> | null;
	currentRouteNoteId: string | null;
	currentView: AppView;
}) =>
	currentView === "note" && currentRouteNoteId && currentNoteId === null
		? { id: currentRouteNoteId }
		: ("skip" as const);

export const resolveCurrentNoteRouteIdentity = ({
	currentNoteId,
	currentRouteNoteId,
	currentView,
	normalizedRouteNoteId,
}: {
	currentNoteId: Id<"notes"> | null;
	currentRouteNoteId: string | null;
	currentView: AppView;
	normalizedRouteNoteId: Id<"notes"> | null | undefined;
}) => ({
	hasInvalidRoute:
		currentView === "note" &&
		currentRouteNoteId !== null &&
		currentNoteId === null &&
		normalizedRouteNoteId === null,
	isResolvingRouteId:
		currentView === "note" &&
		currentRouteNoteId !== null &&
		currentNoteId === null &&
		normalizedRouteNoteId === undefined,
	resolvedNoteId: currentNoteId ?? normalizedRouteNoteId ?? null,
});

export const getSelectedNoteQueryArgs = ({
	hasInvalidRoute,
	noteId,
	view,
	workspaceId,
}: {
	hasInvalidRoute: boolean;
	noteId: Id<"notes"> | null;
	view: AppView;
	workspaceId: Id<"workspaces"> | null;
}) =>
	view === "note" && !hasInvalidRoute && noteId && workspaceId
		? { workspaceId, id: noteId }
		: ("skip" as const);

export const resolveAppShellResourceState = ({
	chats,
	currentChatId,
	currentNoteTitleOverride,
	currentProjectIdString,
	currentView,
	hasInvalidCurrentNoteRoute,
	isResolvingCurrentNoteRouteId,
	projects,
	resolvedCurrentNoteId,
	resolvedSelectedNote,
	resolvingPersistedChatIds,
}: {
	chats: Doc<"chats">[] | undefined;
	currentChatId: string | null;
	currentNoteTitleOverride: {
		noteId: Id<"notes"> | null;
		title: string;
	} | null;
	currentProjectIdString: string | null;
	currentView: AppView;
	hasInvalidCurrentNoteRoute: boolean;
	isResolvingCurrentNoteRouteId: boolean;
	projects: Doc<"projects">[] | undefined;
	resolvedCurrentNoteId: Id<"notes"> | null;
	resolvedSelectedNote: Doc<"notes"> | null | undefined;
	resolvingPersistedChatIds: ReadonlySet<string>;
}) => {
	const currentNoteTitle =
		currentView === "note"
			? currentNoteTitleOverride?.noteId === resolvedCurrentNoteId
				? currentNoteTitleOverride.title
				: (resolvedSelectedNote?.title ?? "")
			: "";
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
		id: currentChatId,
		items: chats,
		matches: (chat, id) => getChatId(chat) === id,
		resolvingIds: resolvingPersistedChatIds,
	});
	const currentChat =
		currentChatRoute.status === "ready" ? currentChatRoute.value : null;
	const isResolvingPendingPersistedChat =
		currentChatId !== null && resolvingPersistedChatIds.has(currentChatId);
	const selectedProjectRoute = resolveCollectionRoute({
		currentView,
		expectedView: "project",
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

	return {
		currentChat,
		currentNoteTitle,
		isResolvingCurrentNote,
		isResolvingResourceRoute: applicationView.isResolving,
		resolvedCurrentView: applicationView.view,
		selectedProject,
	};
};

export const getAppShellChatMetadata = ({
	automationChatId,
	automationChatIds,
	chats,
	currentChat,
	currentChatId,
}: {
	automationChatId: string | null;
	automationChatIds: ReadonlySet<string>;
	chats: Doc<"chats">[] | undefined;
	currentChat: Doc<"chats"> | null;
	currentChatId: string | null;
}) => ({
	automationChatTitle: automationChatId
		? (chats?.find((chat) => getChatId(chat) === automationChatId)?.title ?? "")
		: "",
	currentChatHasAutomation: currentChatId
		? automationChatIds.has(currentChatId)
		: false,
	currentChatNoteId: currentChat?.noteId ?? null,
	currentChatTitle: currentChat?.title || "New chat",
});

export const getIsSharedNote = ({
	currentView,
	resolvedCurrentNoteId,
	selectedNote,
	sharedNotes,
}: {
	currentView: AppView;
	resolvedCurrentNoteId: Id<"notes"> | null;
	selectedNote: Doc<"notes"> | null | undefined;
	sharedNotes: PaginatedNote[] | undefined;
}) =>
	currentView === "note" &&
	(selectedNote?.visibility === "public" ||
		sharedNotes?.some((note) => note._id === resolvedCurrentNoteId) === true);
