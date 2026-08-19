import { constants } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { tool } from "ai";
import {
	decodeLocalUtf8Range,
	detectLocalFileMedia,
} from "./local-file-media.mjs";
import { MAX_LOCAL_IMAGE_UPLOADS } from "./local-folder-image-contract.mjs";
import {
	buildLocalFolderToolConfigs,
	MAX_LOCAL_FILE_READ_BYTES,
	MAX_LOCAL_FOLDER_ROOTS,
} from "./local-folder-tool-definitions.mjs";
import { createLocalWorkspaceSession } from "./local-workspace-paths.mjs";

export { buildLocalFolderSystemContext } from "./local-folder-tool-definitions.mjs";

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
const deferredOpenAIToolOptions = {
	openai: {
		deferLoading: true,
	},
};

const isIgnoredDirectory = (name) => IGNORED_DIRECTORY_NAMES.has(name);

const withDuration = async (operation) => {
	const startedAt = Date.now();
	const output = await operation();

	return {
		...output,
		totalDurationMs: Date.now() - startedAt,
	};
};

const toRootSummary = (root, index) => ({
	index,
	name: root.name,
	path: root.path,
	source: root.source,
});

const openReadOnlyFile = (filePath) =>
	open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);

const listDirectory = async ({ relativePath = ".", rootIndex, workspace }) => {
	const { path: directoryPath, root } = await workspace.resolveExistingPath({
		relativePath,
		rootIndex,
	});
	const directoryStat = await stat(directoryPath);

	if (!directoryStat.isDirectory()) {
		throw new Error("Path is not a directory.");
	}

	const entries = await readdir(directoryPath, { withFileTypes: true });
	const displayableEntries = entries
		.filter(
			(entry) => !entry.name.startsWith(".") || entry.name === ".env.example",
		)
		.filter(
			(entry) => !(entry.isDirectory() && isIgnoredDirectory(entry.name)),
		);
	const visibleEntries = displayableEntries.slice(0, MAX_DIRECTORY_ENTRIES);

	return {
		path: relative(root.path, directoryPath) || ".",
		truncated: displayableEntries.length > visibleEntries.length,
		entries: visibleEntries.map((entry) => ({
			name: entry.name,
			type: entry.isDirectory()
				? "directory"
				: entry.isFile()
					? "file"
					: "other",
		})),
	};
};

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

const readEntireFile = async (
	filePath,
	{ maxBytes = Number.POSITIVE_INFINITY, tooLargeMessage } = {},
) => {
	const file = await openReadOnlyFile(filePath);
	try {
		const fileStat = await file.stat();
		if (!fileStat.isFile()) {
			throw new Error("Path is not a file.");
		}
		if (fileStat.size > maxBytes) {
			throw new Error(tooLargeMessage ?? "File exceeds the read limit.");
		}
		return {
			buffer: await file.readFile(),
			fileStat,
		};
	} finally {
		await file.close();
	}
};

const readLocalFile = async ({
	lengthBytes,
	offsetBytes,
	relativePath,
	rootIndex,
	workspace,
}) => {
	const { path: filePath, root } = await workspace.resolveExistingPath({
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
			nextOffsetBytes: nextOffsetBytes < fileStat.size ? nextOffsetBytes : null,
			offsetBytes: normalizedOffset,
			path: relative(root.path, filePath),
			sizeBytes: fileStat.size,
			truncated: nextOffsetBytes < fileStat.size,
		};
	} finally {
		await file.close();
	}
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
	const depth = imagePath.split("/").length - 1;
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

const inspectLocalImage = async ({
	relativePath,
	rootIndex,
	storeLocalImage,
	workspace,
}) => {
	const { path: filePath, root } = await workspace.resolveExistingPath({
		relativePath,
		rootIndex,
	});
	const { buffer: image, fileStat } = await readEntireFile(filePath, {
		maxBytes: MAX_IMAGE_BYTES,
		tooLargeMessage: `Image file is too large to inspect directly. Maximum size is ${MAX_IMAGE_BYTES} bytes.`,
	});

	const media = detectLocalFileMedia(image.subarray(0, 8_192));
	if (media.kind !== "image") {
		throw new Error(
			`Only supported image files can be inspected. Detected ${media.mediaType}.`,
		);
	}
	const storedImage = await storeLocalImage({
		bytes: image,
		mediaType: media.mediaType,
	});

	return {
		file: {
			filename: basename(filePath),
			mediaType: media.mediaType,
			storageId: storedImage.storageId,
		},
		path: relative(root.path, filePath),
		sizeBytes: fileStat.size,
	};
};

const searchLocalImages = async ({
	maxResults = 5,
	query,
	relativePath = ".",
	rootIndex,
	storeLocalImage,
	workspace,
}) => {
	const needle = query.trim();

	if (!needle) {
		throw new Error("Search query is required.");
	}

	const { path: directoryPath, root } = await workspace.resolveExistingPath({
		relativePath,
		rootIndex,
	});
	const directoryStat = await stat(directoryPath);

	if (!directoryStat.isDirectory()) {
		throw new Error("Search path is not a directory.");
	}

	const files = [];
	await walkFiles({ directory: directoryPath, files, root });

	const rootRelativePath = relative(root.path, directoryPath) || ".";
	const queryTokens = tokenizeSearchQuery(needle);
	const imageCandidates = [];
	for (const imagePath of files) {
		const { path: absolutePath } = await workspace.resolveExistingPath({
			relativePath: imagePath,
			rootIndex,
		});
		const fileHeader = await readFileHeader(absolutePath).catch(() => null);
		if (!fileHeader) {
			continue;
		}
		const media = detectLocalFileMedia(fileHeader.buffer);
		if (media.kind !== "image") {
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
			left.path.split("/").length - right.path.split("/").length ||
			left.path.localeCompare(right.path),
	);
	const totalImageCount = imageCandidates.length;
	const normalizedMaxResults = Math.min(maxResults, MAX_LOCAL_IMAGE_UPLOADS);
	const candidates = imageCandidates.slice(0, normalizedMaxResults);
	const results = [];

	for (const candidate of candidates) {
		const imagePath = candidate.path;
		const { path: absolutePath } = await workspace.resolveExistingPath({
			relativePath: imagePath,
			rootIndex,
		});
		const fileData = await readEntireFile(absolutePath, {
			maxBytes: MAX_IMAGE_BYTES,
		}).catch(() => null);
		const fileStat = fileData?.fileStat ?? null;

		if (!fileStat?.isFile() || fileStat.size > MAX_IMAGE_BYTES) {
			continue;
		}

		const storedImage = await storeLocalImage({
			bytes: fileData.buffer,
			mediaType: candidate.mediaType,
		});
		results.push({
			file: {
				filename: basename(imagePath),
				mediaType: candidate.mediaType,
				storageId: storedImage.storageId,
			},
			path: imagePath,
			sizeBytes: fileStat.size,
		});
	}

	return {
		candidateImageCount: results.length,
		path: rootRelativePath,
		results,
		totalImageCount,
		truncated:
			files.length >= MAX_WALK_FILES || candidates.length < totalImageCount,
	};
};

const walkFiles = async ({ directory, files, root }) => {
	if (files.length >= MAX_WALK_FILES) {
		return;
	}

	const entries = await readdir(directory, { withFileTypes: true }).catch(
		() => [],
	);

	for (const entry of entries) {
		if (files.length >= MAX_WALK_FILES) {
			return;
		}

		if (entry.name.startsWith(".") && entry.name !== ".env.example") {
			continue;
		}

		const entryPath = join(directory, entry.name);

		if (entry.isDirectory()) {
			if (!isIgnoredDirectory(entry.name)) {
				await walkFiles({ directory: entryPath, files, root });
			}
			continue;
		}

		if (entry.isFile()) {
			files.push(relative(root.path, entryPath));
		}
	}
};

const searchLocalFiles = async ({ query, rootIndex, workspace }) => {
	const needle = query.trim().toLowerCase();

	if (!needle) {
		throw new Error("Search query is required.");
	}

	const root = workspace.getRoot(rootIndex);
	const files = [];
	await walkFiles({ directory: root.path, files, root });

	const matches = [];

	for (const relativePath of files) {
		if (matches.length >= MAX_SEARCH_MATCHES) {
			break;
		}

		const pathMatches = relativePath.toLowerCase().includes(needle);
		const { path: absolutePath } = await workspace.resolveExistingPath({
			relativePath,
			rootIndex,
		});
		const headerData = await readFileHeader(absolutePath).catch(() => null);
		const fileStat = headerData?.fileStat ?? null;

		if (!fileStat?.isFile()) {
			continue;
		}

		const lineMatches = [];

		if (fileStat.size <= MAX_SEARCH_FILE_BYTES) {
			const fileData = await readEntireFile(absolutePath, {
				maxBytes: MAX_SEARCH_FILE_BYTES,
			}).catch(() => null);
			const buffer = fileData?.buffer ?? null;
			const media = buffer
				? detectLocalFileMedia(buffer.subarray(0, 8_192))
				: null;
			const lines =
				buffer && media?.kind === "text"
					? buffer.toString("utf8").split(/\r?\n/u)
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
				path: relativePath,
				sizeBytes: fileStat.size,
				matches: lineMatches,
				matchedPath: pathMatches,
			});
		}
	}

	return {
		truncated:
			files.length >= MAX_WALK_FILES || matches.length >= MAX_SEARCH_MATCHES,
		matches,
	};
};

export const buildLocalFolderTools = ({
	executeLocalCommand,
	roots,
	storeLocalImage,
}) => {
	if (roots.length === 0) {
		return {};
	}
	if (typeof executeLocalCommand !== "function") {
		throw new Error("A local command executor is required.");
	}
	if (typeof storeLocalImage !== "function") {
		throw new Error("A local image storage adapter is required.");
	}

	const workspace = createLocalWorkspaceSession(roots);
	const configs = buildLocalFolderToolConfigs(workspace.roots, {
		maxImageSearchResults: MAX_LOCAL_IMAGE_UPLOADS,
		providerOptions: deferredOpenAIToolOptions,
	});

	return {
		list_local_directory: tool({
			...configs.list_local_directory,
			execute: async ({ rootIndex, relativePath }) =>
				withDuration(() =>
					listDirectory({ relativePath, rootIndex, workspace }),
				),
		}),
		read_local_file: tool({
			...configs.read_local_file,
			execute: async ({ lengthBytes, offsetBytes, rootIndex, relativePath }) =>
				withDuration(() =>
					readLocalFile({
						lengthBytes,
						offsetBytes,
						relativePath,
						rootIndex,
						workspace,
					}),
				),
		}),
		inspect_local_image: tool({
			...configs.inspect_local_image,
			execute: async ({ rootIndex, relativePath }) =>
				withDuration(() =>
					inspectLocalImage({
						relativePath,
						rootIndex,
						storeLocalImage,
						workspace,
					}),
				),
		}),
		search_local_images: tool({
			...configs.search_local_images,
			execute: async ({ maxResults, query, relativePath, rootIndex }) =>
				withDuration(() =>
					searchLocalImages({
						maxResults,
						query,
						relativePath,
						rootIndex,
						storeLocalImage,
						workspace,
					}),
				),
		}),
		search_local_files: tool({
			...configs.search_local_files,
			execute: async ({ rootIndex, query }) =>
				withDuration(() =>
					searchLocalFiles({
						query,
						rootIndex,
						workspace,
					}),
				),
		}),
		run_local_command: tool({
			...configs.run_local_command,
			execute: async ({ rootIndex, command }) =>
				withDuration(() =>
					executeLocalCommand({
						command,
						rootPath: workspace.getRoot(rootIndex).path,
					}),
				),
		}),
		get_shared_local_folders: tool({
			...configs.get_shared_local_folders,
			execute: async () =>
				withDuration(async () => ({
					folders: workspace.roots.map(toRootSummary),
				})),
		}),
	};
};

export const buildClientLocalFolderTools = (roots) => {
	if (roots.length === 0) {
		return {};
	}
	if (roots.length > MAX_LOCAL_FOLDER_ROOTS) {
		throw new Error(
			`At most ${MAX_LOCAL_FOLDER_ROOTS} local folders can be shared with one chat.`,
		);
	}

	const configs = buildLocalFolderToolConfigs(roots, {
		maxImageSearchResults: MAX_LOCAL_IMAGE_UPLOADS,
		providerOptions: deferredOpenAIToolOptions,
	});

	return Object.fromEntries(
		Object.entries(configs).map(([name, config]) => [name, tool(config)]),
	);
};
