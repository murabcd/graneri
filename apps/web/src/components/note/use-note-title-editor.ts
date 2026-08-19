import { useMutation } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import { logError } from "@/lib/logger";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { optimisticPatchNote } from "./optimistic-patch-note";

type NoteTitleTarget = {
	id: Id<"notes">;
	title: string;
};

type NoteTitleEditorOptions = {
	noteId: Id<"notes"> | null;
	onPreviewChange?: (title: string) => void;
	title: string | null;
	workspaceId: Id<"workspaces"> | null;
};

export type NoteTitleEditorController = {
	cancel: () => void;
	commit: () => Promise<void>;
	inputRef: React.RefObject<HTMLInputElement | null>;
	isSaving: boolean;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	setValue: (value: string) => void;
	start: () => void;
	value: string;
};

export function useNoteTitleEditor({
	noteId,
	onPreviewChange,
	title,
	workspaceId,
}: NoteTitleEditorOptions): NoteTitleEditorController {
	const [open, setOpen] = React.useState(false);
	const [value, setValueState] = React.useState("");
	const [isSaving, setIsSaving] = React.useState(false);
	const inputRef = React.useRef<HTMLInputElement>(null);
	const targetRef = React.useRef<NoteTitleTarget | null>(null);
	const isSavingRef = React.useRef(false);
	const renameNote = useMutation(api.notes.rename).withOptimisticUpdate(
		(localStore, args) => {
			const nextTitle = args.title.trim();
			optimisticPatchNote(localStore, args.workspaceId, args.id, (note) => ({
				...note,
				title: nextTitle,
			}));
		},
	);

	const start = React.useCallback(() => {
		if (!noteId || title === null) {
			return;
		}

		targetRef.current = { id: noteId, title };
		setValueState(title);
		setOpen(true);
	}, [noteId, title]);

	const cancel = React.useCallback(() => {
		const target = targetRef.current;
		if (!target) {
			return;
		}

		setValueState(target.title);
		onPreviewChange?.(target.title);
		setOpen(false);
	}, [onPreviewChange]);

	const commit = React.useCallback(async () => {
		const target = targetRef.current;
		if (!workspaceId || !target || isSavingRef.current) {
			return;
		}

		const nextTitle = value.trim();
		if (nextTitle === target.title.trim()) {
			setValueState(nextTitle);
			onPreviewChange?.(nextTitle);
			setOpen(false);
			return;
		}

		isSavingRef.current = true;
		setIsSaving(true);
		try {
			await renameNote({
				workspaceId,
				id: target.id,
				title: nextTitle,
			});
			targetRef.current = { ...target, title: nextTitle };
			setValueState(nextTitle);
			onPreviewChange?.(nextTitle);
			setOpen(false);
			toast.success("Note renamed");
		} catch (error) {
			logError({
				event: "client.error",
				error,
				message: "Failed to rename note",
			});
			toast.error("Failed to rename note");
		} finally {
			isSavingRef.current = false;
			setIsSaving(false);
		}
	}, [onPreviewChange, renameNote, value, workspaceId]);

	const onOpenChange = React.useCallback(
		(nextOpen: boolean) => {
			if (nextOpen) {
				start();
				return;
			}

			void commit();
		},
		[commit, start],
	);
	const setValue = React.useCallback(
		(nextValue: string) => {
			setValueState(nextValue);
			onPreviewChange?.(nextValue);
		},
		[onPreviewChange],
	);

	return {
		cancel,
		commit,
		inputRef,
		isSaving,
		onOpenChange,
		open,
		setValue,
		start,
		value,
	};
}
