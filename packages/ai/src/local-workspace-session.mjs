import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, open, realpath, unlink } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import {
	MAX_LOCAL_FILE_SAVE_BYTES,
	MAX_LOCAL_FILE_UPLOADS,
} from "./local-folder-file-contract.mjs";
import {
	assertLocalFolderRootLimit,
	MAX_LOCAL_FILE_READ_BYTES,
} from "./local-folder-tool-definitions.mjs";
import { createLocalWorkspaceTraversal } from "./local-workspace-traversal.mjs";
import {
	assertModelFileMedia,
	decodeModelUtf8Range,
	detectModelFileMedia,
	MAX_MODEL_FILE_BYTES,
} from "./model-file-input.mjs";

const MAX_DIRECTORY_ENTRIES = 200;
const MAX_SEARCH_MATCHES = 40;
const MAX_SEARCH_FILE_BYTES = 20_000_000;
const MAX_SEARCH_PAGE_BYTES = 20_000_000;
const MAX_IMAGE_BYTES = 20_000_000;
const assertInsideRoot = ({ candidatePath, rootPath }) => {
	const rootRelativePath = relative(rootPath, candidatePath);
	if (
		rootRelativePath === ".." ||
		rootRelativePath.startsWith(`..${sep}`) ||
		isAbsolute(rootRelativePath)
	) {
		throw new Error("Path is outside the shared folder.");
	}
};

const validateRoots = (roots) => {
	if (!Array.isArray(roots) || roots.length === 0) {
		throw new Error("At least one shared local folder is required.");
	}
	assertLocalFolderRootLimit(roots);

	const seen = new Set();
	return roots.map((root) => {
		if (
			typeof root?.name !== "string" ||
			!root.name.trim() ||
			typeof root.path !== "string" ||
			!isAbsolute(root.path)
		) {
			throw new Error("Shared local folder metadata is invalid.");
		}
		if (seen.has(root.path)) {
			throw new Error("Shared local folders must be unique.");
		}

		seen.add(root.path);
		return Object.freeze({ ...root });
	});
};

const resolveExistingLocalPath = async ({ relativePath = ".", root }) => {
	const currentRootPath = await realpath(root.path);
	if (currentRootPath !== root.path) {
		throw new Error("Shared folder root is no longer canonical.");
	}

	const candidatePath = resolve(root.path, relativePath);
	assertInsideRoot({ candidatePath, rootPath: root.path });
	const canonicalPath = await realpath(candidatePath);
	assertInsideRoot({ candidatePath: canonicalPath, rootPath: root.path });
	return canonicalPath;
};

const openReadOnlyFile = (filePath) =>
	open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);

const readFileHeader = async (filePath, maxBytes = 8_192) => {
	const file = await openReadOnlyFile(filePath);
	try {
		const fileStat = await file.stat();
		if (!fileStat.isFile()) {
			throw new Error("Path is not a file.");
		}
		const header = Buffer.alloc(Math.min(maxBytes, fileStat.size));
		const { bytesRead } = await file.read(header, 0, header.length, 0);
		return {
			buffer: header.subarray(0, bytesRead),
			fileStat,
		};
	} finally {
		await file.close();
	}
};

const readEntireFile = async (filePath, { maxBytes, tooLargeMessage }) => {
	const file = await openReadOnlyFile(filePath);
	try {
		const fileStat = await file.stat();
		if (!fileStat.isFile()) {
			throw new Error("Path is not a file.");
		}
		if (fileStat.size > maxBytes) {
			throw new Error(tooLargeMessage ?? "File exceeds the read limit.");
		}
		const buffer = Buffer.alloc(fileStat.size);
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
		return {
			buffer: buffer.subarray(0, bytesRead),
			sizeBytes: bytesRead,
		};
	} finally {
		await file.close();
	}
};

export const createLocalWorkspaceSession = (roots) => {
	const canonicalRoots = validateRoots(roots);

	const getRoot = (rootIndex) => {
		if (!Number.isInteger(rootIndex)) {
			throw new Error("Shared folder index must be an integer.");
		}
		const root = canonicalRoots[rootIndex];
		if (!root) {
			throw new Error("Unknown shared folder.");
		}
		return root;
	};

	const resolveExistingPath = async ({ relativePath = ".", rootIndex }) => {
		const root = getRoot(rootIndex);
		return {
			path: await resolveExistingLocalPath({ relativePath, root }),
			root,
		};
	};

	const createTraversal = ({
		cursor,
		query = "",
		relativePath,
		rootIndex,
		operation,
	}) =>
		createLocalWorkspaceTraversal({
			cursor,
			context: {
				root: getRoot(rootIndex).path,
				relativePath,
				query,
				operation,
			},
			relativePath,
			recursive: operation !== "list",
			resolveDirectory: async (path) =>
				(await resolveExistingPath({ relativePath: path, rootIndex })).path,
		});

	const listDirectory = async ({ cursor, relativePath = ".", rootIndex }) => {
		const traversal = await createTraversal({
			cursor,
			relativePath,
			rootIndex,
			operation: "list",
		});
		const entries = [];
		while (entries.length < MAX_DIRECTORY_ENTRIES) {
			const item = await traversal.next();
			if (!item) break;
			entries.push({
				name: item.entry.name,
				type: item.entry.isDirectory()
					? "directory"
					: item.entry.isFile()
						? "file"
						: "other",
			});
		}
		return { entries, path: relativePath, ...traversal.page() };
	};

	const saveFile = async ({ bytes, relativePath, rootIndex }) => {
		if (bytes.byteLength > MAX_LOCAL_FILE_SAVE_BYTES)
			throw new Error("File exceeds the 50 MB local save limit.");
		if (isAbsolute(relativePath))
			throw new Error("A relative output path is required.");
		const { path: parent, root } = await resolveExistingPath({
			relativePath: dirname(relativePath),
			rootIndex,
		});
		if (parent !== resolve(root.path, dirname(relativePath)))
			throw new Error("Output paths cannot traverse symlinks.");
		const destination = resolve(parent, basename(relativePath));
		assertInsideRoot({ candidatePath: destination, rootPath: root.path });
		const temporaryPath = join(parent, `.graneri-save-${randomUUID()}`);
		const file = await open(temporaryPath, "wx", 0o600);
		try {
			await file.writeFile(bytes);
			await file.sync();
			// Linking publishes complete bytes atomically and refuses every existing entry.
			await link(temporaryPath, destination);
		} finally {
			await file.close();
			await unlink(temporaryPath);
		}
		return {
			path: relative(root.path, destination),
			sizeBytes: bytes.byteLength,
		};
	};

	const readTextFile = async ({
		lengthBytes,
		offsetBytes,
		relativePath,
		rootIndex,
	}) => {
		const { path: filePath, root } = await resolveExistingPath({
			relativePath,
			rootIndex,
		});
		const file = await openReadOnlyFile(filePath);
		try {
			const fileStat = await file.stat();
			if (!fileStat.isFile()) {
				throw new Error("Path is not a file.");
			}

			const header = Buffer.alloc(Math.min(8_192, fileStat.size));
			const headerRead = await file.read(header, 0, header.length, 0);
			const media = detectModelFileMedia(
				header.subarray(0, headerRead.bytesRead),
			);
			if (media.kind !== "text") {
				throw new Error(
					`Only UTF-8 text files can be read. Detected ${media.mediaType}.`,
				);
			}

			const normalizedOffset = Math.min(offsetBytes, fileStat.size);
			const normalizedLength = Math.min(
				lengthBytes,
				MAX_LOCAL_FILE_READ_BYTES,
				fileStat.size - normalizedOffset,
			);
			const buffer = Buffer.alloc(normalizedLength);
			const { bytesRead } = await file.read(
				buffer,
				0,
				normalizedLength,
				normalizedOffset,
			);
			const decoded = decodeModelUtf8Range(buffer.subarray(0, bytesRead), {
				allowTrailingPartial: normalizedOffset + bytesRead < fileStat.size,
			});
			if (bytesRead > 0 && decoded.byteLength === 0) {
				throw new Error(
					"The requested byte length is too small for the next UTF-8 character.",
				);
			}
			const nextOffsetBytes = normalizedOffset + decoded.byteLength;

			return {
				content: decoded.text,
				kind: "text",
				lengthBytes: decoded.byteLength,
				mediaType: media.mediaType,
				nextOffsetBytes:
					nextOffsetBytes < fileStat.size ? nextOffsetBytes : null,
				offsetBytes: normalizedOffset,
				path: relative(root.path, filePath),
				sizeBytes: fileStat.size,
				truncated: nextOffsetBytes < fileStat.size,
			};
		} finally {
			await file.close();
		}
	};

	const readFile = async ({
		lengthBytes,
		offsetBytes,
		relativePath,
		rootIndex,
	}) => {
		const { path: filePath, root } = await resolveExistingPath({
			relativePath,
			rootIndex,
		});
		const headerData = await readFileHeader(filePath);
		const headerMedia = detectModelFileMedia(headerData.buffer);
		if (headerMedia.kind === "text") {
			return await readTextFile({
				lengthBytes,
				offsetBytes,
				relativePath,
				rootIndex,
			});
		}
		if (headerMedia.kind === "binary") {
			throw new Error(
				`Unsupported file format. Detected ${headerMedia.mediaType}; supported inputs are UTF-8 text, images, PDF, DOCX, XLSX, and PPTX.`,
			);
		}

		const maximumBytes =
			headerMedia.kind === "image" ? MAX_IMAGE_BYTES : MAX_MODEL_FILE_BYTES;
		const { buffer, sizeBytes } = await readEntireFile(filePath, {
			maxBytes: maximumBytes,
			tooLargeMessage: `File is too large to inspect directly. Maximum size is ${maximumBytes} bytes.`,
		});
		const media = assertModelFileMedia(buffer);
		if (media.kind === "text") {
			throw new Error("File media changed while it was being read.");
		}

		return {
			bytes: buffer,
			filename: basename(filePath),
			kind: "file",
			mediaType: media.mediaType,
			path: relative(root.path, filePath),
			sizeBytes,
		};
	};

	const searchImages = async ({
		cursor,
		maxResults,
		query,
		relativePath = ".",
		rootIndex,
	}) => {
		if (!query.trim()) throw new Error("Search query is required.");
		const traversal = await createTraversal({
			cursor,
			query,
			relativePath,
			rootIndex,
			operation: "image",
		});
		const candidates = [];
		const skippedFiles = [];
		while (candidates.length < Math.min(maxResults, MAX_LOCAL_FILE_UPLOADS)) {
			const item = await traversal.next();
			if (!item) break;
			if (!item.entry.isFile()) continue;
			const { path } = await resolveExistingPath({
				relativePath: item.path,
				rootIndex,
			});
			const header = await readFileHeader(path);
			const media = detectModelFileMedia(header.buffer);
			if (media.kind !== "image") continue;
			if (header.fileStat.size > MAX_IMAGE_BYTES) {
				skippedFiles.push({ path: item.path, reason: "size_limit" });
				continue;
			}
			candidates.push({
				path: item.path,
				absolutePath: path,
				mediaType: media.mediaType,
			});
		}
		const results = await Promise.all(
			candidates.map(async (candidate) => {
				const file = await readEntireFile(candidate.absolutePath, {
					maxBytes: MAX_IMAGE_BYTES,
				});
				return {
					bytes: file.buffer,
					filename: basename(candidate.path),
					mediaType: candidate.mediaType,
					path: candidate.path,
					sizeBytes: file.sizeBytes,
				};
			}),
		);
		return { path: relativePath, results, skippedFiles, ...traversal.page() };
	};

	const searchFiles = async ({
		cursor,
		query,
		relativePath = ".",
		rootIndex,
	}) => {
		const needle = query.trim().toLowerCase();
		if (!needle) throw new Error("Search query is required.");
		const traversal = await createTraversal({
			cursor,
			query,
			relativePath,
			rootIndex,
			operation: "text",
		});
		const matches = [];
		const skippedFiles = [];
		let contentBytesRead = 0;
		while (
			matches.length < MAX_SEARCH_MATCHES &&
			contentBytesRead < MAX_SEARCH_PAGE_BYTES
		) {
			const item = await traversal.next();
			if (!item) break;
			if (!item.entry.isFile()) continue;
			const { path } = await resolveExistingPath({
				relativePath: item.path,
				rootIndex,
			});
			const header = await readFileHeader(path);
			const media = detectModelFileMedia(header.buffer);
			const lineMatches = [];
			if (
				media.kind !== "text" ||
				header.fileStat.size > MAX_SEARCH_FILE_BYTES
			) {
				skippedFiles.push({
					path: item.path,
					reason: media.kind !== "text" ? "non_text" : "size_limit",
				});
			} else {
				const file = await readEntireFile(path, {
					maxBytes: MAX_SEARCH_FILE_BYTES,
				});
				contentBytesRead += file.sizeBytes;
				const text = file.buffer.toString("utf8");
				let start = 0;
				let line = 1;
				while (start < text.length && lineMatches.length < 5) {
					const newline = text.indexOf("\n", start);
					const end = newline < 0 ? text.length : newline;
					const value = text.slice(start, end).replace(/\r$/u, "");
					if (value.toLowerCase().includes(needle))
						lineMatches.push({ line, text: value.slice(0, 500) });
					start = end + 1;
					line += 1;
				}
			}
			const matchedPath = item.path.toLowerCase().includes(needle);
			if (matchedPath || lineMatches.length > 0)
				matches.push({
					matchedPath,
					matches: lineMatches,
					path: item.path,
					sizeBytes: header.fileStat.size,
				});
		}
		return {
			kind: "text-search",
			matches,
			skippedFiles,
			contentBytesRead,
			...traversal.page(),
		};
	};

	return Object.freeze({
		getRoot,
		listDirectory,
		readFile,
		resolveExistingPath,
		saveFile,
		roots: Object.freeze(canonicalRoots),
		searchFiles,
		searchImages,
	});
};
