import { getSchema, type JSONContent } from "@tiptap/core";
import FileHandler from "@tiptap/extension-file-handler";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import {
	type TableOfContentData,
	TableOfContents,
} from "@tiptap/extension-table-of-contents";
import Underline from "@tiptap/extension-underline";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import { Node as PMNode, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { NoteComment } from "./note-comment-extension";
import { NoteFile } from "./note-file-extension";
import { NoteImage } from "./note-image-extension";
import { NOTE_IMAGE_MIME_TYPES } from "./note-image-upload";
import { createNoteSlashCommand } from "./note-slash-command";
import { NOTE_TABLE_RESIZE_HANDLE_WIDTH, NoteTableView } from "./note-table";
import { NoteTableCell, NoteTableHeader } from "./note-table-cell";

export const EMPTY_DOCUMENT: JSONContent = {
	type: "doc",
	content: [{ type: "paragraph" }],
};

export const EMPTY_DOCUMENT_STRING = JSON.stringify(EMPTY_DOCUMENT);

const PLACEHOLDER_TEXT = "Press / for commands";
const BULLET_SYMBOL_PATTERN = /^(\s*)[•◦▪‣·]\s+/u;
const MARKDOWN_LIST_PATTERN = /^\s*(?:[-+*]|\d+\.)\s+/;
const MARKDOWN_HEADING_PATTERN = /^\s{0,3}#{1,6}\s+/;

const markdownManagerBySchema = new WeakMap<Schema, MarkdownManager>();
let defaultNoteSchema: Schema | null = null;

const isTextNode = (
	node: JSONContent | undefined,
): node is JSONContent & {
	type: "text";
	text: string;
} => node?.type === "text" && typeof node.text === "string";

const getParagraphTextMetadata = (node: JSONContent) => {
	if (node.type !== "paragraph" || !node.content?.length) {
		return null;
	}

	let text = "";
	let sawBold = false;
	let sawPlain = false;

	for (const child of node.content) {
		if (!isTextNode(child)) {
			return null;
		}

		text += child.text;

		const marks = child.marks ?? [];
		if (marks.length === 0) {
			if (child.text.trim()) {
				sawPlain = true;
			}
			continue;
		}

		const hasOnlyBoldMark =
			marks.length === 1 &&
			marks[0]?.type === "bold" &&
			child.text.trim().length > 0;

		if (!hasOnlyBoldMark) {
			return null;
		}

		sawBold = true;
	}

	return {
		text: text.trim(),
		isBoldOnly: sawBold && !sawPlain,
		isPlainOnly: !sawBold && sawPlain,
	};
};

const shouldPromoteParagraphToHeading = (
	node: JSONContent,
	nextNode?: JSONContent,
) => {
	const metadata = getParagraphTextMetadata(node);
	if (!metadata) {
		return false;
	}

	const text = metadata.text;
	if (!text || text.length > 120) {
		return false;
	}

	if (metadata.isBoldOnly) {
		return true;
	}

	if (!metadata.isPlainOnly) {
		return false;
	}

	if (
		!nextNode ||
		!["bulletList", "orderedList"].includes(nextNode.type ?? "")
	) {
		return false;
	}

	if (/[.!?;:]$/.test(text)) {
		return false;
	}

	return text.split(/\s+/).length <= 10;
};

const normalizeTopLevelNoteContentNodes = (
	content?: JSONContent[],
): JSONContent[] | undefined => {
	if (!content) {
		return content;
	}

	return content.map((node, index) => {
		const nextNode = content[index + 1];
		if (!shouldPromoteParagraphToHeading(node, nextNode)) {
			return node;
		}

		const text = getParagraphTextMetadata(node)?.text ?? "";
		return {
			type: "heading",
			attrs: {
				level: 2,
			},
			content: text ? [{ type: "text", text }] : undefined,
		} satisfies JSONContent;
	});
};

const normalizeImportedNoteDocument = (document: JSONContent): JSONContent => {
	if (document.type !== "doc") {
		return document;
	}

	return stripUnownedImages({
		...document,
		content: normalizeTopLevelNoteContentNodes(document.content),
	});
};

const stripUnownedImages = (node: JSONContent): JSONContent => ({
	...node,
	content: node.content?.flatMap((child) =>
		child.type === "image" &&
		(typeof child.attrs?.noteImageId !== "string" ||
			child.attrs.noteImageId.length === 0)
			? []
			: [stripUnownedImages(child)],
	),
});

export const normalizePastedPlainText = (text: string) => {
	const lines = text.replace(/\r/g, "").split("\n");
	const normalizedLines = lines.map((line) =>
		line.replace(BULLET_SYMBOL_PATTERN, "$1- "),
	);

	return normalizedLines
		.map((line, index) => {
			const trimmed = line.trim();
			if (
				!trimmed ||
				MARKDOWN_HEADING_PATTERN.test(trimmed) ||
				MARKDOWN_LIST_PATTERN.test(trimmed)
			) {
				return line;
			}

			const nextNonEmptyIndex = normalizedLines.findIndex(
				(candidate, candidateIndex) =>
					candidateIndex > index && candidate.trim().length > 0,
			);
			if (nextNonEmptyIndex < 0) {
				return line;
			}

			const nextLine = normalizedLines[nextNonEmptyIndex]?.trim() ?? "";
			if (!MARKDOWN_LIST_PATTERN.test(nextLine)) {
				return line;
			}

			if (/[.!?;:]$/.test(trimmed) || trimmed.split(/\s+/).length > 10) {
				return line;
			}

			return `## ${trimmed}`;
		})
		.join("\n");
};

export const normalizePastedSlice = (slice: Slice, schema: Schema) => {
	const normalizedDocument = normalizeImportedNoteDocument({
		type: "doc",
		content: slice.content.toJSON() as JSONContent[],
	});
	const normalizedNode = PMNode.fromJSON(schema, normalizedDocument);

	return new Slice(normalizedNode.content, slice.openStart, slice.openEnd);
};

type NoteEditorExtensionsOptions = {
	onTableOfContentsUpdate?: (anchors: TableOfContentData) => void;
	getTableOfContentsScrollParent?: () => HTMLElement | Window;
	onCommentThreadClick?: (threadId: string) => void;
	onImagePaste?: (files: File[]) => void;
	onImageDrop?: (files: File[], position: number) => void;
	onSelectImageCommand?: () => void;
	onSelectFileCommand?: () => void;
	onFileDownload?: (noteAttachmentId: string) => Promise<void>;
};

export const createNoteEditorExtensions = (
	options: NoteEditorExtensionsOptions = {},
) => [
	StarterKit.configure({
		underline: false,
	}),
	TaskList,
	TaskItem.configure({
		nested: true,
		a11y: {
			checkboxLabel: (_node, checked) =>
				checked ? "Mark task as incomplete" : "Mark task as complete",
		},
	}),
	TableKit.configure({
		table: {
			cellMinWidth: 80,
			handleWidth: NOTE_TABLE_RESIZE_HANDLE_WIDTH,
			lastColumnResizable: true,
			renderWrapper: true,
			resizable: true,
			View: NoteTableView,
		},
		tableCell: false,
		tableHeader: false,
	}),
	NoteTableCell,
	NoteTableHeader,
	NoteComment.configure({
		onThreadClick: options.onCommentThreadClick,
	}),
	NoteImage,
	NoteFile.configure({ onDownload: options.onFileDownload }),
	...(options.onImagePaste || options.onImageDrop
		? [
				FileHandler.configure({
					allowedMimeTypes: [...NOTE_IMAGE_MIME_TYPES],
					onPaste: options.onImagePaste
						? (_editor, files) => options.onImagePaste?.(files)
						: undefined,
					onDrop: options.onImageDrop
						? (_editor, files, position) =>
								options.onImageDrop?.(files, position)
						: undefined,
				}),
			]
		: []),
	...(options.onSelectImageCommand && options.onSelectFileCommand
		? [
				createNoteSlashCommand({
					onSelectImage: options.onSelectImageCommand,
					onSelectFile: options.onSelectFileCommand,
				}),
			]
		: []),
	TableOfContents.configure({
		anchorTypes: ["heading"],
		onUpdate: options.onTableOfContentsUpdate,
		scrollParent: options.getTableOfContentsScrollParent,
	}),
	Markdown.configure({
		indentation: {
			style: "space",
			size: 2,
		},
	}),
	Underline,
	Placeholder.configure({
		placeholder: PLACEHOLDER_TEXT,
		emptyEditorClass: "is-editor-empty",
	}),
];

const getMarkdownManager = (schema: Schema) => {
	const existing = markdownManagerBySchema.get(schema);

	if (existing) {
		return existing;
	}

	const nextManager = new MarkdownManager({
		extensions: createNoteEditorExtensions(),
		indentation: {
			style: "space",
			size: 2,
		},
	});
	markdownManagerBySchema.set(schema, nextManager);
	return nextManager;
};

const validateDocument = (document: JSONContent, schema: Schema) => {
	const node = schema.nodeFromJSON(document);
	node.check();
	return node;
};

const getDefaultNoteSchema = () => {
	defaultNoteSchema ??= getSchema(createNoteEditorExtensions());
	return defaultNoteSchema;
};

export const parseMarkdownToDocument = (markdown: string, schema: Schema) => {
	const normalizedDocument = normalizeImportedNoteDocument(
		getMarkdownManager(schema).parse(markdown),
	);

	return PMNode.fromJSON(
		schema,
		validateDocument(normalizedDocument, schema).toJSON(),
	);
};

export const parseStoredNoteContent = (content: string, schema: Schema) => {
	const document = validateDocument(JSON.parse(content) as JSONContent, schema);
	if (document.type.name !== "doc") {
		throw new Error("Stored note content must be a Tiptap document.");
	}
	document.descendants((node) => {
		if (
			node.type.name === "image" &&
			(typeof node.attrs.noteImageId !== "string" ||
				node.attrs.noteImageId.length === 0)
		) {
			throw new Error("Stored note images must identify an uploaded image.");
		}
		if (
			node.type.name === "noteFile" &&
			(typeof node.attrs.noteAttachmentId !== "string" ||
				node.attrs.noteAttachmentId.length === 0)
		) {
			throw new Error(
				"Stored note files must identify an uploaded attachment.",
			);
		}
	});
	return document.toJSON() as JSONContent;
};

export const serializeMarkdownToNoteContent = (markdown: string) =>
	JSON.stringify(
		parseMarkdownToDocument(markdown, getDefaultNoteSchema()).toJSON(),
	);

export const serializeDocumentToMarkdown = (
	document: ProseMirrorNode,
	schema: Schema,
) =>
	getMarkdownManager(schema)
		.serialize(document.toJSON() as JSONContent)
		.trim();

export const looksLikeMarkdown = (value: string) =>
	[
		/^\s{0,3}#{1,6}\s+/m,
		/^\s{0,3}>\s+/m,
		/^\s{0,3}[-+*]\s+/m,
		/^\s{0,3}\d+\.\s+/m,
		/^\s{0,3}```/m,
		/^\s{0,3}(?:---|\*\*\*|___)\s*$/m,
		/\[[^\]]+\]\([^)]+\)/,
		/(^|[^\w])\*\*[^*\n]+\*\*/,
		/(^|[^\w])\*[^*\n]+\*/,
		/`[^`\n]+`/,
	].some((pattern) => pattern.test(value));

export const handleMarkdownPaste = (
	view: EditorView,
	event: ClipboardEvent,
) => {
	const html = event.clipboardData?.getData("text/html") ?? "";
	const text = event.clipboardData?.getData("text/plain") ?? "";
	const normalizedText = normalizePastedPlainText(text);

	if (
		html.trim() ||
		!normalizedText.trim() ||
		!looksLikeMarkdown(normalizedText)
	) {
		return false;
	}

	try {
		const document = parseMarkdownToDocument(normalizedText, view.state.schema);
		const slice = new Slice(document.content, 0, 0);

		view.dispatch(
			view.state.tr
				.replaceSelection(normalizePastedSlice(slice, view.state.schema))
				.scrollIntoView(),
		);
		return true;
	} catch {
		return false;
	}
};
