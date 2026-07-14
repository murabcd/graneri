import { InputGroupButton } from "@workspace/ui/components/input-group";
import { Spinner } from "@workspace/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { FileUIPart } from "ai";
import { FileText, Paperclip, X } from "lucide-react";
import * as React from "react";
import { AttachmentImagePreviewDialog } from "./attachment-image-preview-dialog";
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

					return (
						<div
							key={file.id}
							className={cn(
								"group/attachment-preview relative flex size-14 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground",
								file.uploadStatus === "uploading" && "opacity-80",
							)}
						>
							<button
								type="button"
								className={cn(
									"flex size-12 items-center justify-center overflow-hidden rounded-[5px] bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									canPreview && "cursor-zoom-in",
								)}
								onClick={() => {
									if (canPreview) {
										setPreviewImage(file);
									}
								}}
								aria-label={
									canPreview
										? `Preview ${file.filename || "attached image"}`
										: file.filename || "Attached file"
								}
							>
								{isImage ? (
									<img
										src={file.url}
										alt={file.filename || "Attached image"}
										className="size-full object-cover"
									/>
								) : (
									<FileText className="size-5" />
								)}
							</button>
							{file.uploadStatus === "uploading" ? (
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
