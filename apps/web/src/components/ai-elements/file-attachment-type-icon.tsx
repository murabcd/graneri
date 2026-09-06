import {
	FileArchiveIcon,
	FileCodeIcon,
	FileExcelIcon,
	FileIcon,
	FileImageIcon,
	FilePdfIcon,
	FilePowerpointIcon,
	FileTextIcon,
	FileWordIcon,
	type Icon,
} from "@workspace/ui/components/icons";
import type { FileUIPart } from "ai";
import { cn } from "cn";

import { getFilenameExtension } from "@/lib/chat-file-attachment";

type FileKind =
	| "archive"
	| "code"
	| "document"
	| "file"
	| "image"
	| "pdf"
	| "presentation"
	| "spreadsheet"
	| "word";

const FILE_KIND_ICONS: Record<FileKind, Icon> = {
	archive: FileArchiveIcon,
	code: FileCodeIcon,
	document: FileTextIcon,
	file: FileIcon,
	image: FileImageIcon,
	pdf: FilePdfIcon,
	presentation: FilePowerpointIcon,
	spreadsheet: FileExcelIcon,
	word: FileWordIcon,
};

const FILE_KIND_EXTENSIONS: Partial<Record<string, FileKind>> = {
	csv: "spreadsheet",
	doc: "word",
	docx: "word",
	gif: "image",
	html: "code",
	jpeg: "image",
	jpg: "image",
	js: "code",
	json: "code",
	md: "document",
	pdf: "pdf",
	png: "image",
	ppt: "presentation",
	pptx: "presentation",
	tar: "archive",
	tsx: "code",
	ts: "code",
	tsv: "spreadsheet",
	txt: "document",
	webp: "image",
	xls: "spreadsheet",
	xlsx: "spreadsheet",
	xml: "code",
	zip: "archive",
};

const FILE_KIND_MEDIA_TYPES: Partial<Record<string, FileKind>> = {
	"application/msword": "word",
	"application/pdf": "pdf",
	"application/vnd.ms-excel": "spreadsheet",
	"application/vnd.ms-powerpoint": "presentation",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation":
		"presentation",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		"spreadsheet",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		"word",
};

type FileAttachmentGlyphFile = Pick<FileUIPart, "filename" | "mediaType">;

const getFileKind = (file: FileAttachmentGlyphFile): FileKind => {
	const extension = getFilenameExtension(file.filename);
	const extensionKind = FILE_KIND_EXTENSIONS[extension];

	if (extensionKind) {
		return extensionKind;
	}

	const mediaTypeKind = FILE_KIND_MEDIA_TYPES[file.mediaType];
	if (mediaTypeKind) {
		return mediaTypeKind;
	}

	if (file.mediaType.startsWith("image/")) {
		return "image";
	}

	if (file.mediaType.startsWith("text/")) {
		return "document";
	}

	return "file";
};

export function FileAttachmentGlyph({
	className,
	file,
}: {
	className?: string;
	file: FileAttachmentGlyphFile;
}) {
	const kind = getFileKind(file);
	const Icon = FILE_KIND_ICONS[kind];

	return (
		<Icon
			aria-hidden="true"
			className={cn("size-5 shrink-0", className)}
			data-file-kind={kind}
		/>
	);
}
