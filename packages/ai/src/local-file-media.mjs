const startsWithBytes = (buffer, bytes) =>
	bytes.every((byte, index) => buffer[index] === byte);

const readAscii = (buffer, start, end) =>
	buffer.subarray(start, end).toString("ascii");

const isUtf8Text = (buffer) => {
	if (buffer.includes(0)) {
		return false;
	}

	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer, {
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

export const decodeLocalUtf8Range = (buffer, { allowTrailingPartial }) => {
	const maximumTrimBytes = allowTrailingPartial
		? Math.min(3, buffer.length)
		: 0;
	for (let trimBytes = 0; trimBytes <= maximumTrimBytes; trimBytes += 1) {
		const completeByteLength = buffer.length - trimBytes;
		try {
			return {
				byteLength: completeByteLength,
				text: new TextDecoder("utf-8", { fatal: true }).decode(
					buffer.subarray(0, completeByteLength),
				),
			};
		} catch {
			// A bounded range may end partway through one UTF-8 code point.
		}
	}

	throw new Error("The requested byte range is not valid UTF-8 text.");
};

export const detectLocalFileMedia = (buffer) => {
	if (
		startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	) {
		return { kind: "image", mediaType: "image/png" };
	}
	if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) {
		return { kind: "image", mediaType: "image/jpeg" };
	}
	if (
		readAscii(buffer, 0, 6) === "GIF87a" ||
		readAscii(buffer, 0, 6) === "GIF89a"
	) {
		return { kind: "image", mediaType: "image/gif" };
	}
	if (
		readAscii(buffer, 0, 4) === "RIFF" &&
		readAscii(buffer, 8, 12) === "WEBP"
	) {
		return { kind: "image", mediaType: "image/webp" };
	}
	if (readAscii(buffer, 4, 8) === "ftyp") {
		const brand = readAscii(buffer, 8, 12).trim().toLowerCase();
		if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
			return { kind: "image", mediaType: "image/heic" };
		}
		if (brand === "m4a") {
			return { kind: "audio", mediaType: "audio/mp4" };
		}
		return { kind: "video", mediaType: "video/mp4" };
	}
	if (startsWithBytes(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
		return { kind: "document", mediaType: "application/pdf" };
	}
	if (startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04])) {
		return { kind: "archive", mediaType: "application/zip" };
	}
	if (isUtf8Text(buffer)) {
		return { kind: "text", mediaType: "text/plain; charset=utf-8" };
	}

	return { kind: "binary", mediaType: "application/octet-stream" };
};
