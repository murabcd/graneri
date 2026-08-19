import { useMutation } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import type { AppView } from "@/app/app-types";
import { optimisticRenameChat } from "@/components/chat/optimistic-rename-chat";
import { optimisticRenameNote } from "@/components/note/optimistic-rename-note";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { logError } from "@/lib/logger";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

type RenameKind = "chat" | "note";

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
	  };

type RenamePresentation = {
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
};

export type BreadcrumbTitleEditorController = {
	itemLabel: RenameKind;
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
	currentView: AppView;
	onNoteTitleChange: (title: string) => void;
};

const resolveRenameTarget = ({
	currentChatId,
	currentChatTitle,
	currentNoteId,
	currentNoteTitle,
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
		default:
			return null;
	}
};

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
				currentView,
			}),
		[
			currentChatId,
			currentChatTitle,
			currentNoteId,
			currentNoteTitle,
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

		const nextTitle = value.trim();
		const originalTitle = originalTitleRef.current.trim();

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
