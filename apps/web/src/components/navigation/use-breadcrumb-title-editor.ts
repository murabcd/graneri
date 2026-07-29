import { useMutation } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import type { AppView } from "@/app/app-types";
import { optimisticRenameChat } from "@/components/chat/optimistic-rename-chat";
import { optimisticRenameNote } from "@/components/note/optimistic-rename-note";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { logError } from "@/lib/logger";
import { optimisticRenameProject } from "@/lib/optimistic-projects";
import {
	getProjectNameValidationError,
	MAX_PROJECT_NAME_LENGTH,
	normalizeProjectName,
} from "@/lib/project-name";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

type RenameKind = "chat" | "note" | "project";

type RenameTarget =
	| {
			id: Id<"notes">;
			kind: "note";
			title: string;
	  }
	| {
			id: string;
			kind: "chat";
			title: string;
	  }
	| {
			id: Id<"projects">;
			kind: "project";
			title: string;
	  };

type RenamePresentation = {
	maxLength?: number;
	placeholder: string;
	successMessage: string;
};

const RENAME_PRESENTATION: Record<RenameKind, RenamePresentation> = {
	chat: {
		placeholder: "New chat",
		successMessage: "Chat renamed",
	},
	note: {
		placeholder: "New note",
		successMessage: "Note renamed",
	},
	project: {
		maxLength: MAX_PROJECT_NAME_LENGTH,
		placeholder: "Project name",
		successMessage: "Project renamed",
	},
};

export type BreadcrumbTitleEditorController = {
	itemLabel: RenameKind;
	maxLength?: number;
	onCancel: () => void;
	onCommit: () => void;
	onOpen: () => void;
	onOpenChange: (open: boolean) => void;
	onValueChange: (value: string) => void;
	open: boolean;
	placeholder: string;
	value: string;
};

type BreadcrumbTitleEditorOptions = {
	currentChatId: string | null;
	currentChatNoteId: Id<"notes"> | null;
	currentChatTitle: string;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle: string;
	currentProject: Doc<"projects"> | null;
	currentView: AppView;
	onNoteTitleChange: (title: string) => void;
};

const resolveRenameTarget = ({
	currentChatId,
	currentChatTitle,
	currentNoteId,
	currentNoteTitle,
	currentProject,
	currentView,
}: Omit<
	BreadcrumbTitleEditorOptions,
	"currentChatNoteId" | "onNoteTitleChange"
>): RenameTarget | null => {
	switch (currentView) {
		case "note":
			return currentNoteId
				? {
						id: currentNoteId,
						kind: "note",
						title: currentNoteTitle,
					}
				: null;
		case "chat":
			return currentChatId
				? {
						id: currentChatId,
						kind: "chat",
						title: currentChatTitle,
					}
				: null;
		case "project":
			return currentProject
				? {
						id: currentProject._id,
						kind: "project",
						title: currentProject.name,
					}
				: null;
		default:
			return null;
	}
};

const normalizeRenameTitle = (kind: RenameKind, value: string) =>
	kind === "project" ? normalizeProjectName(value) : value.trim();

export function useBreadcrumbTitleEditor(
	options: BreadcrumbTitleEditorOptions,
): {
	editor: BreadcrumbTitleEditorController | null;
	openEditor: () => void;
} {
	const activeWorkspaceId = useActiveWorkspaceId();
	const {
		currentChatId,
		currentChatNoteId,
		currentChatTitle,
		currentNoteId,
		currentNoteTitle,
		currentProject,
		currentView,
		onNoteTitleChange,
	} = options;
	const renameTarget = React.useMemo(
		() =>
			resolveRenameTarget({
				currentChatId,
				currentChatTitle,
				currentNoteId,
				currentNoteTitle,
				currentProject,
				currentView,
			}),
		[
			currentChatId,
			currentChatTitle,
			currentNoteId,
			currentNoteTitle,
			currentProject,
			currentView,
		],
	);
	const originalTitleRef = React.useRef(renameTarget?.title ?? "");
	const [open, setOpen] = React.useState(false);
	const [value, setValue] = React.useState("");
	const [isRenaming, setIsRenaming] = React.useState(false);
	const renameNote = useMutation(api.notes.rename).withOptimisticUpdate(
		(localStore, args) => {
			optimisticRenameNote(localStore, args.workspaceId, args.id, args.title);
		},
	);
	const renameChat = useMutation(api.chats.updateTitle).withOptimisticUpdate(
		(localStore, args) => {
			optimisticRenameChat(
				localStore,
				args.workspaceId,
				args.chatId,
				args.title,
				currentChatNoteId ?? undefined,
			);
		},
	);
	const renameProject = useMutation(api.projects.rename).withOptimisticUpdate(
		(localStore, args) => {
			optimisticRenameProject(localStore, args.workspaceId, args.id, args.name);
		},
	);

	const openEditor = React.useCallback(() => {
		if (!renameTarget) {
			return;
		}

		originalTitleRef.current = renameTarget.title;
		setValue(renameTarget.title);
		setOpen(true);
	}, [renameTarget]);

	const commit = React.useCallback(async () => {
		if (!activeWorkspaceId || !renameTarget || isRenaming) {
			return;
		}

		const nextTitle = normalizeRenameTitle(renameTarget.kind, value);
		const originalTitle = normalizeRenameTitle(
			renameTarget.kind,
			originalTitleRef.current,
		);

		if (renameTarget.kind === "project") {
			const validationError = getProjectNameValidationError(nextTitle);
			if (validationError) {
				toast.error(validationError);
				return;
			}
		}

		if (nextTitle === originalTitle) {
			setOpen(false);
			setValue(nextTitle);
			return;
		}

		setIsRenaming(true);

		try {
			switch (renameTarget.kind) {
				case "note":
					await renameNote({
						workspaceId: activeWorkspaceId,
						id: renameTarget.id,
						title: nextTitle,
					});
					break;
				case "chat":
					await renameChat({
						workspaceId: activeWorkspaceId,
						chatId: renameTarget.id,
						title: nextTitle,
					});
					break;
				case "project":
					await renameProject({
						workspaceId: activeWorkspaceId,
						id: renameTarget.id,
						name: nextTitle,
					});
					break;
			}

			originalTitleRef.current = nextTitle;
			setOpen(false);
			setValue(nextTitle);
			toast.success(RENAME_PRESENTATION[renameTarget.kind].successMessage);
		} catch (error) {
			logError({
				event: "client.error",
				error,
				message: `Failed to rename ${renameTarget.kind}`,
			});
			toast.error(`Failed to rename ${renameTarget.kind}`);
		} finally {
			setIsRenaming(false);
		}
	}, [
		activeWorkspaceId,
		isRenaming,
		renameChat,
		renameNote,
		renameProject,
		renameTarget,
		value,
	]);

	const handleOpenChange = React.useCallback(
		(nextOpen: boolean) => {
			if (nextOpen) {
				openEditor();
				return;
			}

			void commit();
		},
		[commit, openEditor],
	);

	const handleValueChange = React.useCallback(
		(nextValue: string) => {
			setValue(nextValue);
			if (renameTarget?.kind === "note") {
				onNoteTitleChange(nextValue);
			}
		},
		[onNoteTitleChange, renameTarget?.kind],
	);

	const handleCancel = React.useCallback(() => {
		setOpen(false);
		setValue(originalTitleRef.current);
		if (renameTarget?.kind === "note") {
			onNoteTitleChange(originalTitleRef.current);
		}
	}, [onNoteTitleChange, renameTarget?.kind]);

	if (!renameTarget) {
		return {
			editor: null,
			openEditor,
		};
	}

	const presentation = RENAME_PRESENTATION[renameTarget.kind];

	return {
		editor: {
			itemLabel: renameTarget.kind,
			maxLength: presentation.maxLength,
			onCancel: handleCancel,
			onCommit: () => {
				void commit();
			},
			onOpen: openEditor,
			onOpenChange: handleOpenChange,
			onValueChange: handleValueChange,
			open,
			placeholder: presentation.placeholder,
			value,
		},
		openEditor,
	};
}
