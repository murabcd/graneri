import type { FileUIPart } from "ai";

export type ChatAttachment = FileUIPart & {
	id: string;
	localUrl?: string;
	uploadStatus: "uploading" | "ready";
};

export const restoreChatAttachments = (
	files: readonly FileUIPart[],
): ChatAttachment[] =>
	files.map((file) => ({
		...file,
		id: crypto.randomUUID(),
		uploadStatus: "ready",
	}));

export const completeAttachmentUpload = (
	attachment: ChatAttachment,
	uploadedFile: FileUIPart,
): ChatAttachment => ({
	...attachment,
	filename: uploadedFile.filename,
	localUrl: undefined,
	mediaType: uploadedFile.mediaType,
	providerMetadata: uploadedFile.providerMetadata,
	uploadStatus: "ready",
	url: uploadedFile.url,
});

export const getReadyFileParts = (
	attachments: ChatAttachment[],
): FileUIPart[] =>
	attachments.flatMap((attachment) =>
		attachment.uploadStatus === "ready"
			? [
					{
						type: "file" as const,
						mediaType: attachment.mediaType,
						filename: attachment.filename,
						url: attachment.url,
						providerMetadata: attachment.providerMetadata,
					},
				]
			: [],
	);

export const hasUploadingAttachments = (attachments: ChatAttachment[]) =>
	attachments.some((attachment) => attachment.uploadStatus === "uploading");
