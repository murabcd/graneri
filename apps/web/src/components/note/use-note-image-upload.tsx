import type { Editor } from "@tiptap/core";
import * as React from "react";
import { toast } from "sonner";
import { logError } from "@/lib/logger";
import {
	NOTE_IMAGE_ACCEPT,
	uploadNoteImage,
	validateNoteImageFiles,
} from "@/lib/note-image-upload";
import { trackNoteUploadPosition } from "@/lib/note-upload-position";
import type { Id } from "../../../../../convex/_generated/dataModel";

export type NoteImagePickerIntent =
	| { kind: "insert" }
	| { kind: "replace"; position: number };

type NoteImageUploadContext = {
	activeWorkspaceId: Id<"workspaces"> | null;
	noteId: Id<"notes"> | null;
};

const DEFAULT_IMAGE_PICKER_INTENT: NoteImagePickerIntent = { kind: "insert" };

const reportImageUploadError = (error: unknown) => {
	const message =
		error instanceof Error ? error.message : "Failed to upload image";
	logError({ event: "client.error", error, message });
	toast.error(message);
};

export function useNoteImageUpload({
	activeWorkspaceId,
	noteId,
}: NoteImageUploadContext) {
	const editorRef = React.useRef<Editor | null>(null);
	const imageInputRef = React.useRef<HTMLInputElement>(null);
	const imagePickerIntentRef = React.useRef<NoteImagePickerIntent>(
		DEFAULT_IMAGE_PICKER_INTENT,
	);
	const uploadContextRef = React.useRef<NoteImageUploadContext>({
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

	const uploadImages = React.useCallback(
		async (
			files: File[],
			intent: NoteImagePickerIntent = DEFAULT_IMAGE_PICKER_INTENT,
			requestedPosition?: number,
		) => {
			const editor = editorRef.current;
			const { activeWorkspaceId, noteId } = uploadContextRef.current;
			if (!editor || !activeWorkspaceId || !noteId) {
				toast.error("Open a saved note before adding an image.");
				return;
			}

			let uploadCountWasIncremented = false;
			try {
				if (intent.kind === "replace" && files.length !== 1) {
					throw new Error("Choose one image to replace the selected image.");
				}
				validateNoteImageFiles(files);
				setActiveUploadCount((count) => count + files.length);
				uploadCountWasIncremented = true;

				const trackedPosition = trackNoteUploadPosition(
					editor,
					intent.kind === "replace"
						? intent.position
						: (requestedPosition ?? editor.state.selection.from),
				);

				let uploadedImages: Awaited<ReturnType<typeof uploadNoteImage>>[];
				try {
					uploadedImages = await Promise.all(
						files.map((file) =>
							uploadNoteImage({
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

				if (intent.kind === "replace") {
					const replacement = uploadedImages[0];
					const targetNode = editor.state.doc.nodeAt(targetPosition);
					if (!replacement || targetNode?.type.name !== "image") {
						throw new Error("The selected image is no longer available.");
					}
					editor
						.chain()
						.focus()
						.setNodeSelection(targetPosition)
						.updateAttributes("image", {
							alt: replacement.fileName,
							noteImageId: replacement.noteImageId,
							src: replacement.url,
						})
						.run();
					return;
				}

				editor
					.chain()
					.focus()
					.insertContentAt(
						targetPosition,
						uploadedImages.map((image) => ({
							type: "image",
							attrs: {
								alt: image.fileName,
								noteImageId: image.noteImageId,
								src: image.url,
							},
						})),
					)
					.run();
			} catch (error) {
				reportImageUploadError(error);
			} finally {
				if (uploadCountWasIncremented) {
					setActiveUploadCount((count) => Math.max(0, count - files.length));
				}
			}
		},
		[],
	);

	const openImagePicker = React.useCallback((intent: NoteImagePickerIntent) => {
		imagePickerIntentRef.current = intent;
		if (imageInputRef.current) {
			imageInputRef.current.multiple = intent.kind === "insert";
		}
		imageInputRef.current?.click();
	}, []);

	const uploadSelectedImages = React.useCallback(
		(files: File[]) => {
			const intent = imagePickerIntentRef.current;
			imagePickerIntentRef.current = DEFAULT_IMAGE_PICKER_INTENT;
			return uploadImages(files, intent);
		},
		[uploadImages],
	);

	return {
		activeUploadCount,
		imageInputRef,
		openImagePicker,
		setEditor,
		uploadImages,
		uploadSelectedImages,
	};
}

export function NoteImageUploadInput({
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
			aria-label="Choose images for note"
			accept={NOTE_IMAGE_ACCEPT}
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
