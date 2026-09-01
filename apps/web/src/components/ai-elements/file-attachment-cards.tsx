import {
	Attachment,
	AttachmentAction,
	AttachmentActions,
	AttachmentContent,
	AttachmentDescription,
	AttachmentGroup,
	AttachmentMedia,
	AttachmentTitle,
	AttachmentTrigger,
} from "@workspace/ui/components/attachment";
import { cn } from "@workspace/ui/lib/utils";
import type { FileUIPart } from "ai";
import { Download, LoaderCircle } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { AttachmentImagePreviewDialog } from "@/components/ai-elements/attachment-image-preview-dialog";
import { FileAttachmentGlyph } from "@/components/ai-elements/file-attachment-type-icon";
import {
	formatFileSize,
	getChatFileIdentity,
	getChatFileSizeBytes,
} from "@/lib/chat-file-attachment";
import { downloadUrlAsFile, isDownloadableUrl } from "@/lib/download-file";
import { logError } from "@/lib/logger";

export function FileAttachmentCard({
	file,
	canDownload: canDownloadOverride,
	isDownloading,
	onDownload,
	variant = "card",
}: {
	canDownload?: boolean;
	file: FileUIPart;
	isDownloading: boolean;
	onDownload?: (file: FileUIPart) => void;
	variant?: "card" | "pill";
}) {
	const filename = file.filename || "Attached file";
	const canDownload =
		canDownloadOverride ?? (Boolean(onDownload) && isDownloadableUrl(file.url));
	const hasDownloadAction =
		isDownloading || (canDownload && Boolean(onDownload));
	const downloadAction =
		isDownloading || (canDownload && onDownload) ? (
			<AttachmentActions
				className={cn(
					variant === "pill" && "absolute end-1 top-1/2 -translate-y-1/2",
				)}
			>
				<AttachmentAction
					aria-label={
						isDownloading ? `Downloading ${filename}` : `Download ${filename}`
					}
					className="rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-100"
					disabled={isDownloading}
					onClick={
						isDownloading || !onDownload ? undefined : () => onDownload(file)
					}
					size="icon"
					title={isDownloading ? undefined : `Download ${filename}`}
					type="button"
				>
					{isDownloading ? (
						<LoaderCircle
							aria-hidden="true"
							className="animate-spin motion-reduce:animate-none"
						/>
					) : (
						<Download aria-hidden="true" />
					)}
				</AttachmentAction>
			</AttachmentActions>
		) : null;

	if (variant === "pill") {
		return (
			<Attachment
				className="inline-flex max-w-80 min-w-0 flex-nowrap gap-1 rounded-full border-border/60 bg-muted/50 px-2 py-1.5 text-sm text-foreground focus-within:ring-0 has-data-[slot=attachment-content]:p-0"
				size="xs"
			>
				<FileAttachmentGlyph file={file} />
				<AttachmentContent
					className={cn("leading-5", hasDownloadAction ? "pe-8" : "pe-1")}
				>
					<AttachmentTitle title={filename}>{filename}</AttachmentTitle>
				</AttachmentContent>
				{downloadAction}
			</Attachment>
		);
	}
	const sizeBytes = getChatFileSizeBytes(file);
	const fileDetails = [
		isDownloading ? "Downloading" : null,
		sizeBytes === null ? null : formatFileSize(sizeBytes),
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<Attachment className="h-16 w-[17rem] max-w-full min-w-0 flex-nowrap gap-3 rounded-2xl border-border/60 bg-muted/50 px-3 focus-within:ring-0 has-data-[slot=attachment-content]:p-0">
			<FileAttachmentGlyph className="size-8 shrink-0" file={file} />
			<AttachmentContent className="leading-5">
				<AttachmentTitle className="text-foreground text-sm" title={filename}>
					{filename}
				</AttachmentTitle>
				{fileDetails ? (
					<AttachmentDescription aria-live="polite">
						{fileDetails}
					</AttachmentDescription>
				) : null}
			</AttachmentContent>
			{downloadAction}
		</Attachment>
	);
}

export function FileAttachmentCards({
	align = "start",
	downloadFile = downloadUrlAsFile,
	files,
}: {
	align?: "start" | "end";
	downloadFile?: typeof downloadUrlAsFile;
	files: readonly FileUIPart[];
}) {
	const [previewImage, setPreviewImage] = React.useState<FileUIPart | null>(
		null,
	);
	const [downloadingFileUrls, setDownloadingFileUrls] = React.useState(
		() => new Set<string>(),
	);
	const handleDownload = React.useCallback(
		async (file: FileUIPart) => {
			setDownloadingFileUrls((current) => {
				const next = new Set(current);
				next.add(file.url);
				return next;
			});

			try {
				await downloadFile({
					filename: file.filename || "download",
					url: file.url,
				});
			} catch (error) {
				logError({
					error,
					event: "file_attachment.download_failed",
				});
				toast.error("Failed to download file.");
			} finally {
				setDownloadingFileUrls((current) => {
					const next = new Set(current);
					next.delete(file.url);
					return next;
				});
			}
		},
		[downloadFile],
	);

	if (files.length === 0) {
		return null;
	}

	const imageFiles = files.filter((file) =>
		file.mediaType.startsWith("image/"),
	);
	const documentFiles = files.filter(
		(file) => !file.mediaType.startsWith("image/"),
	);
	const isUserMessage = align === "end";

	return (
		<>
			<div
				className={cn(
					"mt-2 flex max-w-full flex-col gap-2 first:mt-0",
					align === "end" ? "items-end" : "items-start",
				)}
			>
				{imageFiles.length > 0 ? (
					<AttachmentGroup
						className={cn(
							"max-w-full flex-wrap items-end gap-2 overflow-visible py-0 [mask-image:none] snap-none scroll-px-0",
							align === "end" && "justify-end",
						)}
					>
						{imageFiles.map((file) => (
							<Attachment
								className={cn(
									"gap-0 overflow-hidden border-border/60 bg-transparent p-0 focus-within:ring-0 has-data-[slot=attachment-media]:p-0",
									isUserMessage ? "size-20 rounded-lg" : "size-16 rounded-xl",
								)}
								key={getChatFileIdentity(file)}
								size="xs"
							>
								<AttachmentMedia
									className="size-full rounded-[inherit] bg-transparent"
									variant="image"
								>
									<img
										src={file.url}
										alt={file.filename || "Attached image"}
										decoding="async"
										loading="lazy"
										className="size-full object-cover"
									/>
								</AttachmentMedia>
								<AttachmentTrigger
									aria-label={file.filename || "Attached image"}
									className="cursor-zoom-in rounded-[inherit] focus-visible:ring-2 focus-visible:ring-ring"
									onClick={() => setPreviewImage(file)}
								/>
							</Attachment>
						))}
					</AttachmentGroup>
				) : null}
				{documentFiles.length > 0 ? (
					isUserMessage ? (
						<AttachmentGroup className="max-w-full flex-wrap justify-end gap-2 self-end overflow-visible py-0 [mask-image:none] snap-none scroll-px-0">
							{documentFiles.map((file) => (
								<FileAttachmentCard
									key={getChatFileIdentity(file)}
									file={file}
									isDownloading={false}
									variant="pill"
								/>
							))}
						</AttachmentGroup>
					) : (
						<AttachmentGroup className="max-w-full flex-col gap-2 overflow-visible py-0 [mask-image:none] snap-none scroll-px-0">
							{documentFiles.map((file) => (
								<FileAttachmentCard
									key={getChatFileIdentity(file)}
									file={file}
									isDownloading={downloadingFileUrls.has(file.url)}
									onDownload={handleDownload}
								/>
							))}
						</AttachmentGroup>
					)
				) : null}
			</div>
			<AttachmentImagePreviewDialog
				image={previewImage}
				isDownloading={
					previewImage ? downloadingFileUrls.has(previewImage.url) : false
				}
				onClose={() => setPreviewImage(null)}
				onDownload={
					previewImage && isDownloadableUrl(previewImage.url)
						? () => handleDownload(previewImage)
						: undefined
				}
			/>
		</>
	);
}
