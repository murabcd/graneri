import { useMutation } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import { optimisticRenameChat } from "@/components/chat/optimistic-rename-chat";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { logError } from "@/lib/logger";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

type ChatTitleTarget = {
	chatId: string;
	noteId: Id<"notes"> | null;
	title: string;
};

export type BreadcrumbChatTitleEditorController = {
	cancel: () => void;
	commit: () => Promise<void>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	setValue: (value: string) => void;
	start: () => void;
	value: string;
};

export function useBreadcrumbChatTitleEditor({
	chatId,
	noteId,
	title,
}: {
	chatId: string | null;
	noteId: Id<"notes"> | null;
	title: string;
}): {
	editor: BreadcrumbChatTitleEditorController | null;
	openEditor: () => void;
} {
	const activeWorkspaceId = useActiveWorkspaceId();
	const [open, setOpen] = React.useState(false);
	const [value, setValue] = React.useState("");
	const targetRef = React.useRef<ChatTitleTarget | null>(null);
	const isSavingRef = React.useRef(false);
	const renameChat = useMutation(api.chats.updateTitle).withOptimisticUpdate(
		(localStore, args) => {
			optimisticRenameChat(
				localStore,
				args.workspaceId,
				args.chatId,
				args.title,
				targetRef.current?.noteId ?? undefined,
			);
		},
	);

	const openEditor = React.useCallback(() => {
		if (!chatId) {
			return;
		}

		targetRef.current = { chatId, noteId, title };
		setValue(title);
		setOpen(true);
	}, [chatId, noteId, title]);
	const cancel = React.useCallback(() => {
		setValue(targetRef.current?.title ?? "");
		setOpen(false);
	}, []);
	const commit = React.useCallback(async () => {
		const target = targetRef.current;
		if (!activeWorkspaceId || !target || isSavingRef.current) {
			return;
		}

		const nextTitle = value.trim();
		if (nextTitle === target.title.trim()) {
			setValue(nextTitle);
			setOpen(false);
			return;
		}

		isSavingRef.current = true;
		try {
			await renameChat({
				workspaceId: activeWorkspaceId,
				chatId: target.chatId,
				title: nextTitle,
			});
			targetRef.current = { ...target, title: nextTitle };
			setValue(nextTitle);
			setOpen(false);
			toast.success("Chat renamed");
		} catch (error) {
			logError({
				event: "client.error",
				error,
				message: "Failed to rename chat",
			});
			toast.error("Failed to rename chat");
		} finally {
			isSavingRef.current = false;
		}
	}, [activeWorkspaceId, renameChat, value]);
	const onOpenChange = React.useCallback(
		(nextOpen: boolean) => {
			if (nextOpen) {
				openEditor();
				return;
			}

			void commit();
		},
		[commit, openEditor],
	);

	return {
		editor: chatId
			? {
					cancel,
					commit,
					onOpenChange,
					open,
					setValue,
					start: openEditor,
					value,
				}
			: null,
		openEditor,
	};
}
