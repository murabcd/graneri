import { constants } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	decodeLocalUtf8Range,
	detectLocalFileMedia,
} from "./local-file-media.mjs";
import { MAX_LOCAL_IMAGE_UPLOADS } from "./local-folder-image-contract.mjs";
import {
	MAX_LOCAL_FILE_READ_BYTES,
	MAX_LOCAL_FOLDER_ROOTS,
} from "./local-folder-tool-definitions.mjs";

const MAX_DIRECTORY_ENTRIES = 200;
const MAX_WALK_FILES = 1000;
const MAX_SEARCH_MATCHES = 40;
const MAX_SEARCH_FILE_BYTES = 250_000;
const MAX_IMAGE_BYTES = 20_000_000;
const IGNORED_DIRECTORY_NAMES = new Set([
	".cache",
	".git",
	".next",
	".turbo",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"out",
	"target",
]);

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
	if (roots.length > MAX_LOCAL_FOLDER_ROOTS) {
		throw new Error(
			`At most ${MAX_LOCAL_FOLDER_ROOTS} local folders can be shared with one chat.`,
		);
	}

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

const isVisibleEntry = (entry) =>
	(!entry.name.startsWith(".") || entry.name === ".env.example") &&
	!(entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name));

const walkFiles = async ({ directoryPath, root }) => {
	const files = [];

	const visitDirectory = async (currentDirectoryPath) => {
		if (files.length >= MAX_WALK_FILES) {
			return;
		}

		const canonicalDirectoryPath = await resolveExistingLocalPath({
			relativePath: relative(root.path, currentDirectoryPath),
			root,
		});
		const entries = await readdir(canonicalDirectoryPath, {
			withFileTypes: true,
		});

		for (const entry of entries) {
			if (files.length >= MAX_WALK_FILES) {
				return;
			}
			if (!isVisibleEntry(entry)) {
				continue;
			}

			const entryPath = join(canonicalDirectoryPath, entry.name);
			if (entry.isDirectory()) {
				await visitDirectory(entryPath);
			} else if (entry.isFile()) {
				files.push(relative(root.path, entryPath));
			}
		}
	};

	await visitDirectory(directoryPath);
	return {
		files,
		truncated: files.length >= MAX_WALK_FILES,
	};
};

const tokenizeSearchQuery = (query) =>
	query
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3);

const scoreImagePathCandidate = ({
	imagePath,
	queryTokens,
	rootRelativePath,
}) => {
	const normalizedPath = imagePath.toLowerCase();
	const normalizedName = basename(imagePath).toLowerCase();
	const depth = imagePath.split(sep).length - 1;
	const tokenHits = queryTokens.filter((token) =>
		normalizedPath.includes(token),
	).length;
	const screenshotBoost =
		normalizedName.includes("screenshot") ||
		normalizedName.includes("screen shot")
			? 4
			: 0;
	const rootFolderBoost = rootRelativePath === "." && depth === 0 ? 3 : 0;
	const shallowBoost = Math.max(0, 3 - depth);

	return tokenHits * 5 + screenshotBoost + rootFolderBoost + shallowBoost;
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

	const listDirectory = async ({ relativePath = ".", rootIndex }) => {
		const { path: directoryPath, root } = await resolveExistingPath({
			relativePath,
			rootIndex,
		});
		const directoryStat = await stat(directoryPath);
		if (!directoryStat.isDirectory()) {
			throw new Error("Path is not a directory.");
		}

		const entries = await readdir(directoryPath, { withFileTypes: true });
		const displayableEntries = entries.filter(isVisibleEntry);
		const visibleEntries = displayableEntries.slice(0, MAX_DIRECTORY_ENTRIES);

		return {
			entries: visibleEntries.map((entry) => ({
				name: entry.name,
				type: entry.isDirectory()
					? "directory"
					: entry.isFile()
						? "file"
						: "other",
			})),
			path: relative(root.path, directoryPath) || ".",
			truncated: displayableEntries.length > visibleEntries.length,
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
			const media = detectLocalFileMedia(
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
			const decoded = decodeLocalUtf8Range(buffer.subarray(0, bytesRead), {
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

	const readImage = async ({ relativePath, rootIndex }) => {
		const { path: filePath, root } = await resolveExistingPath({
			relativePath,
			rootIndex,
		});
		const { buffer, sizeBytes } = await readEntireFile(filePath, {
			maxBytes: MAX_IMAGE_BYTES,
			tooLargeMessage: `Image file is too large to inspect directly. Maximum size is ${MAX_IMAGE_BYTES} bytes.`,
		});
		const media = detectLocalFileMedia(buffer.subarray(0, 8_192));
		if (media.kind !== "image") {
			throw new Error(
				`Only supported image files can be inspected. Detected ${media.mediaType}.`,
			);
		}

		return {
			bytes: buffer,
			filename: basename(filePath),
			mediaType: media.mediaType,
			path: relative(root.path, filePath),
			sizeBytes,
		};
	};

	const searchImages = async ({
		maxResults,
		query,
		relativePath = ".",
		rootIndex,
	}) => {
		const needle = query.trim();
		if (!needle) {
			throw new Error("Search query is required.");
		}

		const { path: directoryPath, root } = await resolveExistingPath({
			relativePath,
			rootIndex,
		});
		const directoryStat = await stat(directoryPath);
		if (!directoryStat.isDirectory()) {
			throw new Error("Search path is not a directory.");
		}

		const walk = await walkFiles({ directoryPath, root });
		const rootRelativePath = relative(root.path, directoryPath) || ".";
		const queryTokens = tokenizeSearchQuery(needle);
		const imageCandidates = [];
		for (const imagePath of walk.files) {
			const { path: absolutePath } = await resolveExistingPath({
				relativePath: imagePath,
				rootIndex,
			});
			const fileHeader = await readFileHeader(absolutePath);
			const media = detectLocalFileMedia(fileHeader.buffer);
			if (
				media.kind !== "image" ||
				fileHeader.fileStat.size > MAX_IMAGE_BYTES
			) {
				continue;
			}
			imageCandidates.push({
				mediaType: media.mediaType,
				path: imagePath,
				pathScore: scoreImagePathCandidate({
					imagePath,
					queryTokens,
					rootRelativePath,
				}),
			});
		}
		imageCandidates.sort(
			(left, right) =>
				right.pathScore - left.pathScore ||
				left.path.split(sep).length - right.path.split(sep).length ||
				left.path.localeCompare(right.path),
		);
		const totalImageCount = imageCandidates.length;
		const candidates = imageCandidates.slice(
			0,
			Math.min(maxResults, MAX_LOCAL_IMAGE_UPLOADS),
		);
		const results = [];

		for (const candidate of candidates) {
			const { path: absolutePath } = await resolveExistingPath({
				relativePath: candidate.path,
				rootIndex,
			});
			const fileData = await readEntireFile(absolutePath, {
				maxBytes: MAX_IMAGE_BYTES,
			});

			results.push({
				bytes: fileData.buffer,
				filename: basename(candidate.path),
				mediaType: candidate.mediaType,
				path: candidate.path,
				sizeBytes: fileData.sizeBytes,
			});
		}

		return {
			path: rootRelativePath,
			results,
			totalImageCount,
			truncated: walk.truncated || candidates.length < totalImageCount,
		};
	};

	const searchFiles = async ({ query, rootIndex }) => {
		const needle = query.trim().toLowerCase();
		if (!needle) {
			throw new Error("Search query is required.");
		}

		const root = getRoot(rootIndex);
		const { path: rootPath } = await resolveExistingPath({ rootIndex });
		const walk = await walkFiles({ directoryPath: rootPath, root });
		const matches = [];

		for (const relativePath of walk.files) {
			if (matches.length >= MAX_SEARCH_MATCHES) {
				break;
			}

			const pathMatches = relativePath.toLowerCase().includes(needle);
			const { path: absolutePath } = await resolveExistingPath({
				relativePath,
				rootIndex,
			});
			const headerData = await readFileHeader(absolutePath);

			const lineMatches = [];
			if (headerData.fileStat.size <= MAX_SEARCH_FILE_BYTES) {
				const fileData = await readEntireFile(absolutePath, {
					maxBytes: MAX_SEARCH_FILE_BYTES,
				});
				const media = detectLocalFileMedia(fileData.buffer.subarray(0, 8_192));
				const lines =
					media.kind === "text"
						? fileData.buffer.toString("utf8").split(/\r?\n/u)
						: [];

				for (let index = 0; index < lines.length; index += 1) {
					if (lines[index].toLowerCase().includes(needle)) {
						lineMatches.push({
							line: index + 1,
							text: lines[index].slice(0, 500),
						});
					}
					if (lineMatches.length >= 5) {
						break;
					}
				}
			}

			if (pathMatches || lineMatches.length > 0) {
				matches.push({
					matchedPath: pathMatches,
					matches: lineMatches,
					path: relativePath,
					sizeBytes: headerData.fileStat.size,
				});
			}
		}

		return {
			matches,
			truncated: walk.truncated || matches.length >= MAX_SEARCH_MATCHES,
		};
	};

	return Object.freeze({
		getRoot,
		listDirectory,
		readImage,
		readTextFile,
		roots: Object.freeze(canonicalRoots),
		searchFiles,
		searchImages,
	});
};
