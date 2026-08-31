import { mergeAttributes, Node } from "@tiptap/core";
import {
	NodeViewWrapper,
	type ReactNodeViewProps,
	ReactNodeViewRenderer,
} from "@tiptap/react";
import { cn } from "@workspace/ui/lib/utils";
import type { FileUIPart } from "ai";
import * as React from "react";
import { FileAttachmentCard } from "@/components/ai-elements/file-attachment-cards";

export type NoteFileAttributes = {
	noteAttachmentId: string;
	filename: string;
	mediaType: string;
	sizeBytes: number;
};

type NoteFileOptions = {
	onDownload?: (noteAttachmentId: string) => Promise<void>;
};

const readNoteFileAttributes = (
	props: ReactNodeViewProps,
): NoteFileAttributes => ({
	noteAttachmentId:
		typeof props.node.attrs.noteAttachmentId === "string"
			? props.node.attrs.noteAttachmentId
			: "",
	filename:
		typeof props.node.attrs.filename === "string"
			? props.node.attrs.filename
			: "Attached file",
	mediaType:
		typeof props.node.attrs.mediaType === "string"
			? props.node.attrs.mediaType
			: "application/octet-stream",
	sizeBytes:
		typeof props.node.attrs.sizeBytes === "number"
			? props.node.attrs.sizeBytes
			: 0,
});

const createNoteFileNodeView = (options: NoteFileOptions) =>
	function NoteFileNodeView(props: ReactNodeViewProps) {
		const [isDownloading, setIsDownloading] = React.useState(false);
		const onDownload = options.onDownload;
		const attributes = readNoteFileAttributes(props);
		const file: FileUIPart = {
			type: "file",
			filename: attributes.filename,
			mediaType: attributes.mediaType,
			providerMetadata: {
				graneri: { sizeBytes: attributes.sizeBytes },
			},
			url: "",
		};
		const handleDownload = async () => {
			if (!onDownload || isDownloading) {
				return;
			}
			setIsDownloading(true);
			try {
				await onDownload(attributes.noteAttachmentId);
			} finally {
				setIsDownloading(false);
			}
		};

		return (
			<NodeViewWrapper
				className={cn(
					"note-file-node",
					props.selected && "ProseMirror-selectednode",
				)}
				contentEditable={false}
				data-note-attachment-id={attributes.noteAttachmentId}
			>
				<FileAttachmentCard
					canDownload={Boolean(onDownload)}
					file={file}
					isDownloading={isDownloading}
					onDownload={() => {
						void handleDownload();
					}}
					variant="pill"
				/>
			</NodeViewWrapper>
		);
	};

export const NoteFile = Node.create<NoteFileOptions>({
	name: "noteFile",
	group: "block",
	atom: true,
	selectable: true,

	addOptions() {
		return {};
	},

	addAttributes() {
		return {
			noteAttachmentId: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-note-attachment-id"),
				renderHTML: (attributes) => ({
					"data-note-attachment-id": attributes.noteAttachmentId,
				}),
			},
			filename: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-filename"),
				renderHTML: (attributes) => ({
					"data-filename": attributes.filename,
				}),
			},
			mediaType: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-media-type"),
				renderHTML: (attributes) => ({
					"data-media-type": attributes.mediaType,
				}),
			},
			sizeBytes: {
				default: null,
				parseHTML: (element) => Number(element.getAttribute("data-size-bytes")),
				renderHTML: (attributes) => ({
					"data-size-bytes": attributes.sizeBytes,
				}),
			},
		};
	},

	parseHTML() {
		return [{ tag: "div[data-note-attachment-id]" }];
	},

	renderHTML({ HTMLAttributes }) {
		return ["div", mergeAttributes(HTMLAttributes)];
	},

	renderMarkdown(node) {
		const filename =
			typeof node.attrs?.filename === "string"
				? node.attrs.filename
				: "Attached file";
		return `File: ${filename}`;
	},

	addNodeView() {
		return ReactNodeViewRenderer(createNoteFileNodeView(this.options));
	},
});
