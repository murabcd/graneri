import { type Icon, Icons } from "@workspace/ui/components/icons";
import { cn } from "@workspace/ui/lib/utils";
import type { FileUIPart } from "ai";

const getFilenameExtension = (filename?: string) => {
	const extension = filename?.split(".").at(-1)?.trim();
	return extension && extension !== filename ? extension.toLowerCase() : "";
};

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
	archive: Icons.fileArchive,
	code: Icons.fileCode,
	document: Icons.fileText,
	file: Icons.file,
	image: Icons.fileImage,
	pdf: Icons.filePdf,
	presentation: Icons.filePowerpoint,
	spreadsheet: Icons.fileExcel,
	word: Icons.fileWord,
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

const getFileKind = (file: FileUIPart): FileKind => {
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
	file: FileUIPart;
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
