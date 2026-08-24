import type { FileUIPart } from "ai";
import { useMutation } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import { z } from "zod";
import { logError } from "@/lib/logger";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { ChatAttachment } from "./file-attachment-utils";
import { detectModelFileAttachmentMediaType } from "./model-file-attachment";

const attachmentUploadResultSchema = z.object({
	storageId: z.custom<Id<"_storage">>(
		(value) => typeof value === "string" && value.length > 0,
	),
});

export function useRevokeAttachmentObjectUrls(attachments: ChatAttachment[]) {
	const localUrlById = React.useMemo(() => new Map<string, string>(), []);

	React.useEffect(() => {
		const nextLocalUrlById = new Map<string, string>();

		for (const attachment of attachments) {
			if (attachment.localUrl) {
				nextLocalUrlById.set(attachment.id, attachment.localUrl);
			}
		}

		for (const [id, localUrl] of localUrlById) {
			if (nextLocalUrlById.get(id) !== localUrl) {
				URL.revokeObjectURL(localUrl);
			}
		}

		localUrlById.clear();
		for (const [id, localUrl] of nextLocalUrlById) {
			localUrlById.set(id, localUrl);
		}
	}, [attachments, localUrlById]);

	React.useEffect(
		() => () => {
			for (const localUrl of localUrlById.values()) {
				URL.revokeObjectURL(localUrl);
			}
			localUrlById.clear();
		},
		[localUrlById],
	);
}

function useConvexFileAttachmentUpload() {
	const generateUploadUrl = useMutation(api.chatAttachments.generateUploadUrl);
	const getFileUrl = useMutation(api.chatAttachments.getUrl);

	return React.useCallback(
		async (file: File): Promise<FileUIPart> => {
			const [mediaType, uploadUrl] = await Promise.all([
				detectModelFileAttachmentMediaType(file),
				generateUploadUrl(),
			]);
			const response = await fetch(uploadUrl, {
				method: "POST",
				headers: { "Content-Type": mediaType },
				body: file,
			});

			if (!response.ok) {
				throw new Error("Attachment upload failed.");
			}

			const result = attachmentUploadResultSchema.parse(await response.json());

			const url = await getFileUrl({ storageId: result.storageId });
			if (!url) {
				throw new Error("Attachment upload did not return a file URL.");
			}

			return {
				type: "file",
				mediaType,
				filename: file.name,
				url,
				providerMetadata: {
					graneri: {
						sizeBytes: file.size,
						storageId: result.storageId,
					},
				},
			};
		},
		[generateUploadUrl, getFileUrl],
	);
}

function createPendingAttachment(
	file: File,
	idSuffix: number,
	localUrl: string,
): ChatAttachment {
	return {
		id: [file.name, file.size, file.lastModified, Date.now(), idSuffix].join(
			":",
		),
		type: "file",
		mediaType: file.type || "application/octet-stream",
		filename: file.name,
		providerMetadata: { graneri: { sizeBytes: file.size } },
		url: localUrl,
		localUrl,
		uploadStatus: "uploading",
	};
}

function hasDraggedFiles(event: React.DragEvent<HTMLElement>) {
	return Array.from(event.dataTransfer.types).includes("Files");
}

function getPastedFiles(event: React.ClipboardEvent<HTMLElement>) {
	const { clipboardData } = event;
	if (!clipboardData) {
		return [];
	}

	const files = Array.from(clipboardData.files);
	if (files.length > 0) {
		return files;
	}

	const pastedFiles: File[] = [];
	for (const item of Array.from(clipboardData.items)) {
		if (item.kind !== "file") {
			continue;
		}

		const file = item.getAsFile();
		if (file) {
			pastedFiles.push(file);
		}
	}

	return pastedFiles;
}

export function useFileAttachmentDropzone({
	disabled,
	onFilesAdded,
	onFileUploadFailed,
	onFileUploaded,
}: {
	disabled?: boolean;
	onFilesAdded: (files: ChatAttachment[]) => void;
	onFileUploadFailed: (id: string) => void;
	onFileUploaded: (id: string, file: FileUIPart) => void;
}) {
	const attachmentIdCounterRef = React.useRef(0);
	const dragDepthRef = React.useRef(0);
	const [isDragOver, setIsDragOver] = React.useState(false);
	const uploadFile = useConvexFileAttachmentUpload();

	const uploadFiles = React.useCallback(
		(files: File[]) => {
			if (disabled || files.length === 0) {
				return;
			}

			const attachments = files.map((file) => {
				attachmentIdCounterRef.current += 1;
				return createPendingAttachment(
					file,
					attachmentIdCounterRef.current,
					URL.createObjectURL(file),
				);
			});

			onFilesAdded(attachments);

			for (const [index, file] of files.entries()) {
				const attachment = attachments[index];
				void uploadFile(file)
					.then((uploadedFile) => onFileUploaded(attachment.id, uploadedFile))
					.catch((error) => {
						logError({
							event: "client.error",
							error,
							message: "Failed to upload attachment",
						});
						toast.error(
							error instanceof Error
								? error.message
								: "Attachment upload failed.",
						);
						onFileUploadFailed(attachment.id);
					});
			}
		},
		[disabled, onFileUploadFailed, onFileUploaded, onFilesAdded, uploadFile],
	);

	const handleDragEnter = React.useCallback(
		(event: React.DragEvent<HTMLElement>) => {
			if (disabled || !hasDraggedFiles(event)) {
				return;
			}

			event.preventDefault();
			dragDepthRef.current += 1;
			setIsDragOver(true);
		},
		[disabled],
	);

	const handleDragOver = React.useCallback(
		(event: React.DragEvent<HTMLElement>) => {
			if (disabled || !hasDraggedFiles(event)) {
				return;
			}

			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
			setIsDragOver(true);
		},
		[disabled],
	);

	const handleDragLeave = React.useCallback(
		(event: React.DragEvent<HTMLElement>) => {
			if (disabled || !hasDraggedFiles(event)) {
				return;
			}

			event.preventDefault();
			dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
			if (dragDepthRef.current === 0) {
				setIsDragOver(false);
			}
		},
		[disabled],
	);

	const handleDrop = React.useCallback(
		(event: React.DragEvent<HTMLElement>) => {
			if (disabled || !hasDraggedFiles(event)) {
				return;
			}

			event.preventDefault();
			dragDepthRef.current = 0;
			setIsDragOver(false);
			uploadFiles(Array.from(event.dataTransfer.files));
		},
		[disabled, uploadFiles],
	);

	const handlePaste = React.useCallback(
		(event: React.ClipboardEvent<HTMLElement>) => {
			if (disabled) {
				return;
			}

			const files = getPastedFiles(event);
			if (files.length === 0) {
				return;
			}

			event.preventDefault();
			uploadFiles(files);
		},
		[disabled, uploadFiles],
	);

	return {
		isDragOver,
		uploadFiles,
		dropzoneProps: {
			onDragEnter: handleDragEnter,
			onDragOver: handleDragOver,
			onDragLeave: handleDragLeave,
			onDrop: handleDrop,
			onPaste: handlePaste,
		},
	};
}
