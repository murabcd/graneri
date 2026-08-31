import { Button } from "@workspace/ui/components/button";
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
	const downloadAction = isDownloading ? (
		<Button
			aria-label={`Downloading ${filename}`}
			className={cn(
				"size-8 shrink-0 rounded-full text-muted-foreground disabled:opacity-100",
				variant === "pill" && "absolute end-1 top-1/2 -translate-y-1/2",
			)}
			disabled
			size="icon-sm"
			type="button"
			variant="ghost"
		>
			<LoaderCircle
				aria-hidden="true"
				className="size-4 animate-spin motion-reduce:animate-none"
			/>
		</Button>
	) : canDownload && onDownload ? (
		<Button
			aria-label={`Download ${filename}`}
			className={cn(
				"size-8 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground",
				variant === "pill" && "absolute end-1 top-1/2 -translate-y-1/2",
			)}
			onClick={() => onDownload(file)}
			size="icon-sm"
			title={`Download ${filename}`}
			type="button"
			variant="ghost"
		>
			<Download aria-hidden="true" className="size-4" />
		</Button>
	) : null;

	if (variant === "pill") {
		return (
			<div className="relative inline-flex max-w-80 min-w-0 items-center gap-1 rounded-full border border-border/60 bg-muted/50 px-2 py-1.5 text-sm text-foreground">
				<FileAttachmentGlyph file={file} />
				<span
					className={cn(
						"min-w-0 truncate font-medium",
						hasDownloadAction ? "pe-8" : "pe-1",
					)}
					title={filename}
				>
					{filename}
				</span>
				{downloadAction}
			</div>
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
		<div className="flex h-16 w-[17rem] max-w-full min-w-0 items-center gap-3 rounded-2xl border border-border/60 bg-muted/50 px-3">
			<FileAttachmentGlyph className="size-8 shrink-0" file={file} />
			<div className="min-w-0 flex-1">
				<p
					className="truncate font-medium text-foreground text-sm"
					title={filename}
				>
					{filename}
				</p>
				{fileDetails ? (
					<p
						aria-live="polite"
						className="mt-0.5 truncate text-muted-foreground text-xs"
					>
						{fileDetails}
					</p>
				) : null}
			</div>
			{downloadAction}
		</div>
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
					<div
						className={cn(
							"flex max-w-full flex-wrap items-end gap-2",
							align === "end" && "justify-end",
						)}
					>
						{imageFiles.map((file) => (
							<button
								key={getChatFileIdentity(file)}
								type="button"
								className={cn(
									"cursor-zoom-in overflow-hidden border border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									isUserMessage ? "size-20 rounded-lg" : "size-16 rounded-xl",
								)}
								onClick={() => setPreviewImage(file)}
							>
								<img
									src={file.url}
									alt={file.filename || "Attached image"}
									className={cn(
										"size-full object-cover",
										isUserMessage && "rounded-md",
									)}
								/>
							</button>
						))}
					</div>
				) : null}
				{documentFiles.length > 0 ? (
					isUserMessage ? (
						<div className="flex max-w-full flex-wrap justify-end gap-2 self-end">
							{documentFiles.map((file) => (
								<FileAttachmentCard
									key={getChatFileIdentity(file)}
									file={file}
									isDownloading={false}
									variant="pill"
								/>
							))}
						</div>
					) : (
						<div className="flex max-w-full flex-col gap-2">
							{documentFiles.map((file) => (
								<FileAttachmentCard
									key={getChatFileIdentity(file)}
									file={file}
									isDownloading={downloadingFileUrls.has(file.url)}
									onDownload={handleDownload}
								/>
							))}
						</div>
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
