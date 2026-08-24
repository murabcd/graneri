import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import type { FileUIPart } from "ai";
import { Download, FileText, LoaderCircle } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { AttachmentImagePreviewDialog } from "@/components/ai-elements/attachment-image-preview-dialog";
import {
	formatFileSize,
	getChatFileSizeBytes,
} from "@/lib/chat-file-attachment";
import { downloadUrlAsFile, isDownloadableUrl } from "@/lib/download-file";
import { logError } from "@/lib/logger";

type DocumentAppearance = {
	badgeClassName: string;
	extension: string;
	iconClassName: string;
};

const getFilenameExtension = (filename?: string) => {
	const extension = filename?.split(".").at(-1)?.trim();
	return extension && extension !== filename ? extension.toLowerCase() : "";
};

const getDocumentAppearance = (file: FileUIPart): DocumentAppearance => {
	const extension = getFilenameExtension(file.filename);

	if (file.mediaType === "application/pdf" || extension === "pdf") {
		return {
			badgeClassName: "bg-rose-500 text-white",
			extension: "PDF",
			iconClassName: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
		};
	}

	if (
		file.mediaType ===
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
		extension === "docx"
	) {
		return {
			badgeClassName: "bg-blue-500 text-white",
			extension: "DOCX",
			iconClassName: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
		};
	}

	if (
		file.mediaType ===
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
		extension === "xlsx"
	) {
		return {
			badgeClassName: "bg-emerald-600 text-white",
			extension: "XLSX",
			iconClassName: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
		};
	}

	if (
		file.mediaType ===
			"application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
		extension === "pptx"
	) {
		return {
			badgeClassName: "bg-orange-600 text-white",
			extension: "PPTX",
			iconClassName: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
		};
	}

	return {
		badgeClassName: "bg-muted-foreground text-background",
		extension: extension.toUpperCase().slice(0, 4) || "FILE",
		iconClassName: "bg-muted text-muted-foreground",
	};
};

function DocumentAttachmentCard({
	file,
	isDownloading,
	onDownload,
}: {
	file: FileUIPart;
	isDownloading: boolean;
	onDownload: (file: FileUIPart) => void;
}) {
	const appearance = getDocumentAppearance(file);
	const filename = file.filename || "Attached file";
	const sizeBytes = getChatFileSizeBytes(file);
	const fileDetails = [
		isDownloading ? "Downloading" : appearance.extension,
		sizeBytes === null ? null : formatFileSize(sizeBytes),
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<div className="flex h-16 w-[17rem] max-w-full min-w-0 items-center gap-3 rounded-xl border border-border/60 bg-background/80 px-3 shadow-sm">
			<div
				className={cn(
					"relative flex size-10 shrink-0 items-center justify-center rounded-lg",
					appearance.iconClassName,
				)}
			>
				<FileText aria-hidden="true" className="size-5" strokeWidth={1.8} />
				<span
					className={cn(
						"absolute -right-1 -bottom-1 rounded px-1 py-0.5 font-bold text-[8px] leading-none tracking-tight",
						appearance.badgeClassName,
					)}
				>
					{appearance.extension}
				</span>
			</div>
			<div className="min-w-0 flex-1">
				<p
					className="truncate font-medium text-foreground text-sm"
					title={filename}
				>
					{filename}
				</p>
				<p
					aria-live="polite"
					className="mt-0.5 truncate text-muted-foreground text-xs"
				>
					{fileDetails}
				</p>
			</div>
			{isDownloading ? (
				<Button
					aria-label={`Downloading ${filename}`}
					className="size-8 shrink-0 rounded-full text-muted-foreground disabled:opacity-100"
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
			) : isDownloadableUrl(file.url) ? (
				<Button
					aria-label={`Download ${filename}`}
					className="size-8 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
					onClick={() => onDownload(file)}
					size="icon-sm"
					title={`Download ${filename}`}
					type="button"
					variant="ghost"
				>
					<Download aria-hidden="true" className="size-4" />
				</Button>
			) : null}
		</div>
	);
}

export function ChatMessageFileAttachments({
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
					event: "chat.attachment_download_failed",
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
	const containsOnlyDocuments = files.every(
		(file) => !file.mediaType.startsWith("image/"),
	);

	return (
		<>
			<div
				className={cn(
					"mt-2 flex max-w-full gap-2 first:mt-0",
					containsOnlyDocuments ? "flex-col" : "flex-wrap",
					align === "end" &&
						(containsOnlyDocuments ? "items-end" : "justify-end"),
				)}
			>
				{files.map((file) =>
					file.mediaType.startsWith("image/") ? (
						<button
							key={file.url}
							type="button"
							className="size-24 cursor-zoom-in overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onClick={() => setPreviewImage(file)}
						>
							<img
								src={file.url}
								alt={file.filename || "Attached image"}
								className="size-full object-cover"
							/>
						</button>
					) : (
						<DocumentAttachmentCard
							key={file.url}
							file={file}
							isDownloading={downloadingFileUrls.has(file.url)}
							onDownload={handleDownload}
						/>
					),
				)}
			</div>
			<AttachmentImagePreviewDialog
				image={previewImage}
				onClose={() => setPreviewImage(null)}
			/>
		</>
	);
}
