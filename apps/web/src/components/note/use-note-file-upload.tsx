import type { Editor } from "@tiptap/core";
import * as React from "react";
import { toast } from "sonner";
import { logError } from "@/lib/logger";
import {
	NOTE_FILE_ACCEPT,
	uploadNoteFile,
	validateNoteFileSelection,
} from "@/lib/note-file-upload";
import { trackNoteUploadPosition } from "@/lib/note-upload-position";
import type { Id } from "../../../../../convex/_generated/dataModel";

type NoteFileUploadContext = {
	activeWorkspaceId: Id<"workspaces"> | null;
	noteId: Id<"notes"> | null;
};

const reportFileUploadError = (error: unknown) => {
	const message =
		error instanceof Error ? error.message : "Failed to upload file";
	logError({ event: "client.error", error, message });
	toast.error(message);
};

export function useNoteFileUpload({
	activeWorkspaceId,
	noteId,
}: NoteFileUploadContext) {
	const editorRef = React.useRef<Editor | null>(null);
	const fileInputRef = React.useRef<HTMLInputElement>(null);
	const insertionPositionRef = React.useRef<number | null>(null);
	const uploadContextRef = React.useRef<NoteFileUploadContext>({
		activeWorkspaceId,
		noteId,
	});
	const [activeUploadCount, setActiveUploadCount] = React.useState(0);

	React.useEffect(() => {
		uploadContextRef.current = { activeWorkspaceId, noteId };
	}, [activeWorkspaceId, noteId]);

	const setEditor = React.useCallback((editor: Editor | null) => {
		editorRef.current = editor;
	}, []);

	const openFilePicker = React.useCallback(() => {
		const editor = editorRef.current;
		if (!editor) {
			return;
		}
		insertionPositionRef.current = editor.state.selection.from;
		fileInputRef.current?.click();
	}, []);

	const uploadSelectedFiles = React.useCallback(async (files: File[]) => {
		const editor = editorRef.current;
		const { activeWorkspaceId, noteId } = uploadContextRef.current;
		if (!editor || !activeWorkspaceId || !noteId) {
			toast.error("Open a saved note before adding a file.");
			return;
		}

		let uploadCountWasIncremented = false;
		try {
			validateNoteFileSelection(files);
			setActiveUploadCount((count) => count + files.length);
			uploadCountWasIncremented = true;
			const trackedPosition = trackNoteUploadPosition(
				editor,
				insertionPositionRef.current ?? editor.state.selection.from,
			);
			insertionPositionRef.current = null;

			let uploadedFiles: Awaited<ReturnType<typeof uploadNoteFile>>[];
			try {
				uploadedFiles = await Promise.all(
					files.map((file) =>
						uploadNoteFile({
							file,
							noteId,
							workspaceId: activeWorkspaceId,
						}),
					),
				);
			} finally {
				trackedPosition.stop();
			}
			const targetPosition = trackedPosition.read();

			if (editor.isDestroyed) {
				return;
			}
			const currentContext = uploadContextRef.current;
			if (
				currentContext.noteId !== noteId ||
				currentContext.activeWorkspaceId !== activeWorkspaceId
			) {
				return;
			}

			editor
				.chain()
				.focus()
				.insertContentAt(
					targetPosition,
					uploadedFiles.map((file) => ({
						type: "noteFile",
						attrs: file,
					})),
				)
				.run();
		} catch (error) {
			reportFileUploadError(error);
		} finally {
			insertionPositionRef.current = null;
			if (uploadCountWasIncremented) {
				setActiveUploadCount((count) => Math.max(0, count - files.length));
			}
		}
	}, []);

	return {
		activeUploadCount,
		fileInputRef,
		openFilePicker,
		setEditor,
		uploadSelectedFiles,
	};
}

export function NoteFileUploadInput({
	disabled,
	inputRef,
	onSelect,
}: {
	disabled: boolean;
	inputRef: React.RefObject<HTMLInputElement | null>;
	onSelect: (files: File[]) => void;
}) {
	return (
		<input
			ref={inputRef}
			type="file"
			aria-label="Choose files for note"
			accept={NOTE_FILE_ACCEPT}
			multiple
			disabled={disabled}
			className="sr-only"
			onChange={(event) => {
				const files = Array.from(event.currentTarget.files ?? []);
				event.currentTarget.value = "";
				if (files.length > 0) {
					onSelect(files);
				}
			}}
		/>
	);
}
