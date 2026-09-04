import type { AppView } from "@/app/app-types";
import { getNoteDisplayTitle } from "@/lib/note-title";
import type { Doc } from "../../../../convex/_generated/dataModel";

export const getAppShellBreadcrumbDetailLabel = ({
	currentChatId,
	currentChatTitle,
	currentNoteTitle,
	currentView,
	isResolvingCurrentNote,
	isResolvingResourceRoute,
	selectedProject,
}: {
	currentChatId: string | null;
	currentChatTitle: string;
	currentNoteTitle: string;
	currentView: AppView;
	isResolvingCurrentNote: boolean;
	isResolvingResourceRoute: boolean;
	selectedProject: Doc<"projects"> | null;
}) => {
	if (isResolvingResourceRoute || currentView === "notFound") return null;
	if (currentView === "note" && !isResolvingCurrentNote) {
		return getNoteDisplayTitle(currentNoteTitle);
	}
	if (currentView === "chat" && currentChatId) return currentChatTitle;
	return currentView === "project" ? (selectedProject?.name ?? null) : null;
};

export const handleAppShellBreadcrumbClick = ({
	currentView,
	isSharedNote,
	onOpenFreshChat,
	onViewChange,
}: {
	currentView: AppView;
	isSharedNote: boolean;
	onOpenFreshChat: () => void;
	onViewChange: (view: AppView) => void;
}) => {
	if (currentView === "chat") {
		onOpenFreshChat();
		return;
	}
	if (
		currentView === "automation" ||
		currentView === "calendar" ||
		currentView === "companies" ||
		currentView === "people"
	) {
		onViewChange(currentView);
		return;
	}
	if (currentView === "project" || currentView === "notFound") {
		onViewChange("home");
		return;
	}
	onViewChange(currentView === "shared" || isSharedNote ? "shared" : "home");
};
