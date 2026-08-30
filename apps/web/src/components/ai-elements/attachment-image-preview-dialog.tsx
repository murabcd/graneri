import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Download, LoaderCircle, X } from "lucide-react";
import type { CSSProperties } from "react";

export type AttachmentImagePreview = {
	url: string;
	filename?: string;
};

export function AttachmentImagePreviewDialog({
	image,
	isDownloading = false,
	onClose,
	onDownload,
}: {
	image: AttachmentImagePreview | null;
	isDownloading?: boolean;
	onClose: () => void;
	onDownload?: () => void;
}) {
	return (
		<Dialog
			open={image !== null}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
		>
			<DialogContent
				showCloseButton={false}
				className="!top-0 !left-0 !flex !h-screen !w-screen !max-w-none !translate-x-0 !translate-y-0 items-center justify-center !rounded-none !border-0 !bg-transparent p-10 !shadow-none !ring-0 sm:!max-w-none"
				style={
					{
						"--tw-enter-scale": "1",
						"--tw-exit-scale": "1",
					} as CSSProperties
				}
				onPointerDown={(event) => {
					if (event.target === event.currentTarget) {
						onClose();
					}
				}}
			>
				<DialogTitle className="sr-only">
					{image?.filename || "Attached image preview"}
				</DialogTitle>
				<DialogDescription className="sr-only">
					Image attachment preview.
				</DialogDescription>
				{image ? (
					<img
						src={image.url}
						alt={image.filename || "Attached image preview"}
						className="max-h-full max-w-full object-contain shadow-2xl"
					/>
				) : null}
				<div className="absolute top-4 right-4 flex items-center gap-2">
					{onDownload && image ? (
						<Button
							aria-label={
								isDownloading
									? `Downloading ${image.filename || "image"}`
									: `Download ${image.filename || "image"}`
							}
							className="rounded-full bg-background/90 text-foreground shadow-lg hover:bg-background disabled:opacity-100"
							disabled={isDownloading}
							onClick={onDownload}
							size="icon"
							type="button"
							variant="ghost"
						>
							{isDownloading ? (
								<LoaderCircle
									aria-hidden="true"
									className="size-5 animate-spin motion-reduce:animate-none"
								/>
							) : (
								<Download aria-hidden="true" className="size-5" />
							)}
						</Button>
					) : null}
					<DialogClose className="cursor-pointer rounded-full bg-background/90 p-2 text-foreground shadow-lg transition hover:bg-background focus:outline-none focus:ring-2 focus:ring-ring">
						<X className="size-5" />
						<span className="sr-only">Close</span>
					</DialogClose>
				</div>
			</DialogContent>
		</Dialog>
	);
}
