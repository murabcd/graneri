import { MODEL_FILE_INPUT_ACCEPT } from "@workspace/ai/model-file-input";
import { InputGroupButton } from "@workspace/ui/components/input-group";
import { Spinner } from "@workspace/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { FileUIPart } from "ai";
import { Paperclip, X } from "lucide-react";
import * as React from "react";
import {
	formatFileSize,
	getChatFileSizeBytes,
} from "@/lib/chat-file-attachment";
import { AttachmentImagePreviewDialog } from "./attachment-image-preview-dialog";
import { FileAttachmentGlyph } from "./file-attachment-type-icon";
import type { ChatAttachment } from "./file-attachment-utils";
import { useFileAttachmentDropzone } from "./use-file-attachments";

export function FileAttachmentButton({
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
	const inputRef = React.useRef<HTMLInputElement | null>(null);
	const { uploadFiles } = useFileAttachmentDropzone({
		disabled,
		onFilesAdded,
		onFileUploadFailed,
		onFileUploaded,
	});

	return (
		<>
			<input
				ref={inputRef}
				accept={MODEL_FILE_INPUT_ACCEPT}
				aria-label="Attach files"
				className="hidden"
				multiple
				onChange={(event) => {
					const files = event.currentTarget.files;
					if (!files || files.length === 0) {
						return;
					}

					const selectedFiles = Array.from(files);
					uploadFiles(selectedFiles);

					if (inputRef.current) {
						inputRef.current.value = "";
					}
				}}
				type="file"
			/>
			<Tooltip>
				<TooltipTrigger asChild>
					<InputGroupButton
						aria-label="Attach files"
						className="shrink-0 rounded-full bg-transparent !text-muted-foreground shadow-none hover:bg-muted hover:!text-foreground"
						disabled={disabled}
						onClick={() => inputRef.current?.click()}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<Paperclip className="size-4" />
					</InputGroupButton>
				</TooltipTrigger>
				<TooltipContent>Attach files</TooltipContent>
			</Tooltip>
		</>
	);
}

export function FileAttachmentChips({
	files,
	onRemove,
}: {
	files: ChatAttachment[];
	onRemove: (index: number) => void;
}) {
	const [previewImage, setPreviewImage] = React.useState<ChatAttachment | null>(
		null,
	);

	if (files.length === 0) {
		return null;
	}

	return (
		<>
			<div className="no-scrollbar -m-1.5 flex min-w-0 flex-1 gap-1.5 overflow-x-auto p-1.5">
				{files.map((file, index) => {
					const isImage = file.mediaType.startsWith("image/");
					const canPreview = isImage && file.url.length > 0;
					const filename = file.filename || "Attached file";
					const sizeBytes = getChatFileSizeBytes(file);
					const fileDetails = [
						file.uploadStatus === "uploading" ? "Uploading" : null,
						sizeBytes === null ? null : formatFileSize(sizeBytes),
					]
						.filter(Boolean)
						.join(" · ");

					return (
						<div
							key={file.id}
							className={cn(
								"group/attachment-preview relative flex h-14 shrink-0 items-center justify-center rounded-lg text-muted-foreground",
								isImage
									? "w-14 bg-muted/50"
									: "w-56 justify-start gap-2.5 border border-border/60 bg-muted/50 px-2.5",
								file.uploadStatus === "uploading" && "opacity-80",
							)}
						>
							{isImage ? (
								<button
									type="button"
									className={cn(
										"flex size-14 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										canPreview && "cursor-zoom-in",
									)}
									onClick={() => {
										if (canPreview) {
											setPreviewImage(file);
										}
									}}
									aria-label={canPreview ? `Preview ${filename}` : filename}
								>
									<img
										src={file.url}
										alt={filename}
										className="size-full object-cover"
									/>
								</button>
							) : (
								<>
									<FileAttachmentGlyph
										className="size-7 shrink-0"
										file={file}
									/>
									<div className="min-w-0 flex-1">
										<p
											className="truncate font-medium text-foreground text-sm"
											title={filename}
										>
											{filename}
										</p>
										{fileDetails ? (
											<p className="mt-0.5 truncate text-xs">{fileDetails}</p>
										) : null}
									</div>
									{file.uploadStatus === "uploading" ? (
										<Spinner
											className="mr-1 size-4"
											aria-label="Uploading file"
										/>
									) : null}
								</>
							)}
							{isImage && file.uploadStatus === "uploading" ? (
								<div className="absolute inset-0 flex items-center justify-center bg-background/55 backdrop-blur-[1px]">
									<Spinner className="size-4" aria-label="Uploading file" />
								</div>
							) : null}
							<button
								type="button"
								className="absolute -top-1.5 -right-1.5 z-10 flex size-4 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-[opacity,transform] duration-150 ease-out hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] group-hover/attachment-preview:opacity-100"
								onClick={() => onRemove(index)}
								aria-label={`Remove ${file.filename || "attachment"}`}
							>
								<X className="size-3" />
							</button>
						</div>
					);
				})}
			</div>
			<AttachmentImagePreviewDialog
				image={previewImage}
				onClose={() => setPreviewImage(null)}
			/>
		</>
	);
}
