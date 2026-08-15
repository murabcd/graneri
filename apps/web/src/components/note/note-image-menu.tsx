import { AllSelection, NodeSelection, Selection } from "@tiptap/pm/state";
import { useTiptap, useTiptapState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Button } from "@workspace/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	ArrowDownToLine,
	Captions,
	RefreshCw,
	Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
	NOTE_IMAGE_ALIGNMENTS,
	type NoteImageAlignment,
} from "@/lib/note-image-extension";

const preventEditorBlur = (event: React.MouseEvent<HTMLElement>) => {
	event.preventDefault();
};

const getDownloadFileName = (alt: string | null, src: string | null) => {
	if (alt?.trim()) {
		return alt.trim();
	}
	if (src) {
		try {
			const pathName = new URL(src).pathname;
			const fileName = pathName.split("/").pop();
			if (fileName) {
				return decodeURIComponent(fileName);
			}
		} catch {
			// Fall through to the stable default.
		}
	}
	return "note-image";
};

const downloadImage = async (src: string, fileName: string) => {
	const response = await fetch(src);
	if (!response.ok) {
		throw new Error("Image download failed.");
	}
	const objectUrl = URL.createObjectURL(await response.blob());
	try {
		const anchor = document.createElement("a");
		anchor.href = objectUrl;
		anchor.download = fileName;
		anchor.click();
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
};

function ImageMenuTooltip({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent
				side="bottom"
				sideOffset={8}
				className="pointer-events-none select-none"
			>
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

const ALIGNMENT_OPTIONS = [
	{ align: "left", label: "Align image left", Icon: AlignLeft },
	{ align: "center", label: "Align image center", Icon: AlignCenter },
	{ align: "right", label: "Align image right", Icon: AlignRight },
] as const;

export function NoteImageMenu({
	onReplace,
}: {
	onReplace: (position: number) => void;
}) {
	const { editor } = useTiptap();
	const imageState = useTiptapState(({ editor: currentEditor }) => {
		const attributes = currentEditor.getAttributes("image");
		return {
			align:
				NOTE_IMAGE_ALIGNMENTS.find(
					(alignment) => alignment === attributes.align,
				) ?? "left",
			alt: typeof attributes.alt === "string" ? attributes.alt : null,
			captionVisible: attributes.captionVisible === true,
			src: typeof attributes.src === "string" ? attributes.src : null,
		};
	});

	React.useEffect(() => {
		const clearImageSelection = (event: PointerEvent) => {
			if (editor.isDestroyed) {
				return;
			}

			const target = event.target;
			if (
				target instanceof Element &&
				target.closest(
					".note-image-node.ProseMirror-selectednode, .note-image-menu",
				)
			) {
				return;
			}

			const { doc, selection } = editor.state;
			if (
				!(selection instanceof NodeSelection) ||
				selection.node.type.name !== "image"
			) {
				return;
			}

			const afterImage = Selection.near(doc.resolve(selection.to), 1);
			if (!(afterImage instanceof NodeSelection)) {
				editor.view.dispatch(editor.state.tr.setSelection(afterImage));
				return;
			}

			const beforeImage = Selection.near(doc.resolve(selection.from), -1);
			editor.view.dispatch(
				editor.state.tr.setSelection(
					beforeImage instanceof NodeSelection
						? new AllSelection(doc)
						: beforeImage,
				),
			);
		};

		document.addEventListener("pointerdown", clearImageSelection, true);
		return () => {
			document.removeEventListener("pointerdown", clearImageSelection, true);
		};
	}, [editor]);

	const setAlignment = React.useCallback(
		(align: NoteImageAlignment) => {
			editor.chain().focus().updateAttributes("image", { align }).run();
		},
		[editor],
	);
	const toggleCaption = React.useCallback(() => {
		const nextVisible = !imageState.captionVisible;
		editor
			.chain()
			.focus()
			.updateAttributes("image", { captionVisible: nextVisible })
			.run();
		if (nextVisible) {
			requestAnimationFrame(() => {
				if (editor.isDestroyed) {
					return;
				}
				editor.view.dom
					.querySelector<HTMLInputElement>(
						"figure.note-image-node.ProseMirror-selectednode .note-image-caption",
					)
					?.focus();
			});
		}
	}, [editor, imageState.captionVisible]);
	const handleDownload = React.useCallback(async () => {
		if (!imageState.src) {
			toast.error("This image is unavailable.");
			return;
		}
		try {
			await downloadImage(
				imageState.src,
				getDownloadFileName(imageState.alt, imageState.src),
			);
		} catch {
			toast.error("Failed to download image.");
		}
	}, [imageState.alt, imageState.src]);

	return (
		<BubbleMenu
			updateDelay={100}
			options={{ offset: 10 }}
			shouldShow={({ editor: currentEditor }) => {
				const { selection } = currentEditor.state;
				return (
					currentEditor.isEditable &&
					selection instanceof NodeSelection &&
					selection.node.type.name === "image"
				);
			}}
		>
			<div
				className="note-image-menu"
				role="toolbar"
				aria-label="Image options"
			>
				{ALIGNMENT_OPTIONS.map(({ align, label, Icon }) => (
					<ImageMenuTooltip key={align} label={label}>
						<Button
							type="button"
							variant={imageState.align === align ? "secondary" : "ghost"}
							size="icon-sm"
							aria-label={label}
							aria-pressed={imageState.align === align}
							onMouseDown={preventEditorBlur}
							onClick={() => setAlignment(align)}
						>
							<Icon />
						</Button>
					</ImageMenuTooltip>
				))}
				<div aria-hidden="true" className="note-image-menu-separator" />
				<ImageMenuTooltip label="Caption">
					<Button
						type="button"
						variant={imageState.captionVisible ? "secondary" : "ghost"}
						size="icon-sm"
						aria-label="Toggle image caption"
						aria-pressed={imageState.captionVisible}
						onMouseDown={preventEditorBlur}
						onClick={toggleCaption}
					>
						<Captions />
					</Button>
				</ImageMenuTooltip>
				<ImageMenuTooltip label="Download">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Download image"
						onMouseDown={preventEditorBlur}
						onClick={() => void handleDownload()}
					>
						<ArrowDownToLine />
					</Button>
				</ImageMenuTooltip>
				<ImageMenuTooltip label="Replace">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Replace image"
						onMouseDown={preventEditorBlur}
						onClick={() => onReplace(editor.state.selection.from)}
					>
						<RefreshCw />
					</Button>
				</ImageMenuTooltip>
				<div aria-hidden="true" className="note-image-menu-separator" />
				<ImageMenuTooltip label="Delete">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Delete image"
						onMouseDown={preventEditorBlur}
						onClick={() => editor.chain().focus().deleteSelection().run()}
					>
						<Trash2 />
					</Button>
				</ImageMenuTooltip>
			</div>
		</BubbleMenu>
	);
}
