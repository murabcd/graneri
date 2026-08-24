const DOCUMENT_MEDIA_TYPES = Object.freeze({
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	pdf: "application/pdf",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});
const MODEL_FILE_PART_MEDIA_TYPES = new Set([
	...Object.values(DOCUMENT_MEDIA_TYPES),
	"image/gif",
	"image/heic",
	"image/jpeg",
	"image/png",
	"image/webp",
]);

export const MAX_MODEL_FILE_BYTES = 50_000_000;
export const MODEL_FILE_INPUT_ACCEPT = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/heic",
	".heif",
	".pdf",
	".docx",
	".xlsx",
	".pptx",
	".txt",
	".md",
	".csv",
	".json",
	".html",
	".xml",
	".yaml",
	".yml",
	".js",
	".jsx",
	".ts",
	".tsx",
	".py",
	".css",
	".sql",
].join(",");

const startsWithBytes = (bytes, expected) =>
	expected.every((byte, index) => bytes[index] === byte);

const startsWithBytesAt = (bytes, offset, expected) =>
	expected.every((byte, index) => bytes[offset + index] === byte);

const readAscii = (bytes, start, end) =>
	String.fromCharCode(...bytes.subarray(start, end));

const readUint16LittleEndian = (bytes, offset) =>
	bytes[offset] | (bytes[offset + 1] << 8);

const isUtf8Text = (bytes) => {
	if (bytes.includes(0)) {
		return false;
	}

	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, {
			stream: true,
		});
		let controlCharacterCount = 0;
		for (const character of text) {
			const codePoint = character.codePointAt(0) ?? 0;
			if (
				codePoint < 32 &&
				codePoint !== 9 &&
				codePoint !== 10 &&
				codePoint !== 12 &&
				codePoint !== 13
			) {
				controlCharacterCount += 1;
			}
		}
		return text.length === 0 || controlCharacterCount / text.length < 0.01;
	} catch {
		return false;
	}
};

const readZipEntryNames = (bytes) => {
	const names = new Set();
	for (let offset = 0; offset + 30 <= bytes.length; offset += 1) {
		if (!startsWithBytesAt(bytes, offset, [0x50, 0x4b, 0x03, 0x04])) {
			continue;
		}

		const filenameLength = readUint16LittleEndian(bytes, offset + 26);
		const filenameStart = offset + 30;
		const filenameEnd = filenameStart + filenameLength;
		if (filenameLength === 0 || filenameEnd > bytes.length) {
			continue;
		}

		try {
			names.add(
				new TextDecoder("utf-8", { fatal: true }).decode(
					bytes.subarray(filenameStart, filenameEnd),
				),
			);
		} catch {
			// Invalid ZIP entry names cannot establish a supported OOXML format.
		}
		offset = filenameEnd - 1;
	}
	return names;
};

const detectOpenXmlMedia = (bytes) => {
	const names = readZipEntryNames(bytes);
	if (!names.has("[Content_Types].xml")) {
		return null;
	}
	for (const name of names) {
		if (name.startsWith("word/")) {
			return { format: "docx", mediaType: DOCUMENT_MEDIA_TYPES.docx };
		}
		if (name.startsWith("xl/")) {
			return { format: "xlsx", mediaType: DOCUMENT_MEDIA_TYPES.xlsx };
		}
		if (name.startsWith("ppt/")) {
			return { format: "pptx", mediaType: DOCUMENT_MEDIA_TYPES.pptx };
		}
	}
	return null;
};

export const detectModelFileMedia = (bytes) => {
	if (!(bytes instanceof Uint8Array)) {
		throw new TypeError("File bytes must be a Uint8Array.");
	}
	if (
		startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	) {
		return { kind: "image", mediaType: "image/png" };
	}
	if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) {
		return { kind: "image", mediaType: "image/jpeg" };
	}
	if (
		readAscii(bytes, 0, 6) === "GIF87a" ||
		readAscii(bytes, 0, 6) === "GIF89a"
	) {
		return { kind: "image", mediaType: "image/gif" };
	}
	if (readAscii(bytes, 0, 4) === "RIFF" && readAscii(bytes, 8, 12) === "WEBP") {
		return { kind: "image", mediaType: "image/webp" };
	}
	if (readAscii(bytes, 4, 8) === "ftyp") {
		const brand = readAscii(bytes, 8, 12).trim().toLowerCase();
		if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
			return { kind: "image", mediaType: "image/heic" };
		}
	}
	if (startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
		return {
			format: "pdf",
			kind: "document",
			mediaType: DOCUMENT_MEDIA_TYPES.pdf,
		};
	}
	if (startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04])) {
		const openXmlMedia = detectOpenXmlMedia(bytes);
		return openXmlMedia
			? { ...openXmlMedia, kind: "document" }
			: { kind: "archive", mediaType: "application/zip" };
	}
	if (isUtf8Text(bytes)) {
		return { kind: "text", mediaType: "text/plain; charset=utf-8" };
	}

	return { kind: "binary", mediaType: "application/octet-stream" };
};

export const assertModelFileMedia = (bytes) => {
	if (bytes.byteLength > MAX_MODEL_FILE_BYTES) {
		throw new Error(
			`File exceeds the ${MAX_MODEL_FILE_BYTES} byte model input limit.`,
		);
	}
	const media = detectModelFileMedia(bytes);
	switch (media.kind) {
		case "document":
		case "image":
		case "text":
			return media;
		default:
			throw new Error(
				`Unsupported file format. Detected ${media.mediaType}; supported inputs are UTF-8 text, images, PDF, DOCX, XLSX, and PPTX.`,
			);
	}
};

export const isModelFilePartMediaType = (mediaType) =>
	typeof mediaType === "string" && MODEL_FILE_PART_MEDIA_TYPES.has(mediaType);

export const decodeModelUtf8Range = (bytes, { allowTrailingPartial }) => {
	const maximumTrimBytes = allowTrailingPartial ? Math.min(3, bytes.length) : 0;
	for (let trimBytes = 0; trimBytes <= maximumTrimBytes; trimBytes += 1) {
		const completeByteLength = bytes.length - trimBytes;
		try {
			return {
				byteLength: completeByteLength,
				text: new TextDecoder("utf-8", { fatal: true }).decode(
					bytes.subarray(0, completeByteLength),
				),
			};
		} catch {
			// A bounded range may end partway through one UTF-8 code point.
		}
	}

	throw new Error("The requested byte range is not valid UTF-8 text.");
};
