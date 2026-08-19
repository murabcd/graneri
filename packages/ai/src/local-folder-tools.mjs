import { constants } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { openai } from "@ai-sdk/openai";
import { embed, generateText, tool } from "ai";
import {
	decodeLocalUtf8Range,
	detectLocalFileMedia,
} from "./local-file-media.mjs";
import {
	buildLocalFolderToolConfigs,
	MAX_LOCAL_FILE_READ_BYTES,
	MAX_LOCAL_FOLDER_ROOTS,
} from "./local-folder-tool-definitions.mjs";
import { createLocalWorkspaceSession } from "./local-workspace-paths.mjs";
import { aiLogger } from "./logger.mjs";
import {
	DEFAULT_CHAT_MODEL_ID,
	getOpenAiModelProviderOptions,
} from "./models.mjs";

export { buildLocalFolderSystemContext } from "./local-folder-tool-definitions.mjs";

const MAX_DIRECTORY_ENTRIES = 200;
const MAX_WALK_FILES = 1000;
const MAX_SEARCH_MATCHES = 40;
const MAX_SEARCH_FILE_BYTES = 250_000;
const MAX_IMAGE_BYTES = 20_000_000;
const MAX_IMAGE_ANALYSIS_PROMPT_LENGTH = 1_000;
const MAX_IMAGE_SEARCH_FILES = 12;
const MAX_IMAGE_SEARCH_RESULTS = 10;
const imageMetadataCache = new Map();
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

const imageEmbeddingModel = openai.embedding("text-embedding-3-small");

const withDuration = async (operation) => {
	const startedAt = Date.now();
	const output = await operation();

	return {
		...output,
		totalDurationMs: Date.now() - startedAt,
	};
};

const logLocalToolEvent = (event, payload = {}) => {
	const env =
		typeof globalThis.process === "object" &&
		globalThis.process !== null &&
		typeof globalThis.process.env === "object" &&
		globalThis.process.env !== null
			? globalThis.process.env
			: {};
	if (
		env.GRANERI_LOCAL_TOOLS_DEBUG !== "1" &&
		!event.startsWith("image_search_") &&
		!event.startsWith("image_metadata_")
	) {
		return;
	}

	aiLogger.info({
		event: `local_tools.${event}`,
		...payload,
	});
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

const buildImageCacheKey = ({ filePath, fileStat }) =>
	[filePath, fileStat.size, fileStat.mtimeMs].join(":");

const cosineSimilarity = (left, right) => {
	let dot = 0;
	let leftMagnitude = 0;
	let rightMagnitude = 0;
	const length = Math.min(left.length, right.length);

	for (let index = 0; index < length; index += 1) {
		dot += left[index] * right[index];
		leftMagnitude += left[index] * left[index];
		rightMagnitude += right[index] * right[index];
	}

	if (leftMagnitude === 0 || rightMagnitude === 0) {
		return 0;
	}

	return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
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

const scoreImageDescriptionCandidate = ({ description, queryTokens }) => {
	const normalizedDescription = description.toLowerCase();
	const tokenHits = queryTokens.filter((token) =>
		normalizedDescription.includes(token),
	).length;
	const explicitMatchBoost =
		/\b(appears to match|matches|match: yes|yes[, -]|relevant)\b/iu.test(
			description,
		)
			? 0.35
			: 0;
	const explicitNonMatchPenalty =
		/\b(does not match|not a match|match: no|not relevant)\b/iu.test(
			description,
		)
			? 0.6
			: 0;

	return tokenHits * 0.08 + explicitMatchBoost - explicitNonMatchPenalty;
};

const createImageDetailProviderOptions = (detail) =>
	detail === "low" || detail === "high"
		? {
				openai: {
					imageDetail: detail,
				},
			}
		: undefined;

const inspectLocalImage = async ({
	detail = "auto",
	prompt,
	relativePath,
	rootIndex,
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

	const normalizedPrompt =
		typeof prompt === "string"
			? prompt.trim().slice(0, MAX_IMAGE_ANALYSIS_PROMPT_LENGTH)
			: "";
	const media = detectLocalFileMedia(image.subarray(0, 8_192));
	if (media.kind !== "image") {
		throw new Error(
			`Only supported image files can be inspected. Detected ${media.mediaType}.`,
		);
	}
	const { text } = await generateText({
		model: openai(DEFAULT_CHAT_MODEL_ID),
		providerOptions: getOpenAiModelProviderOptions(DEFAULT_CHAT_MODEL_ID, {
			reasoningEffort: "none",
		}),
		messages: [
			{
				role: "user",
				content: [
					{
						type: "text",
						text:
							normalizedPrompt ||
							"Inspect this local image. Describe what is visible, extract any readable text, and mention notable UI, document, chart, or scene details.",
					},
					{
						type: "file",
						data: image,
						mediaType: media.mediaType,
						providerOptions: createImageDetailProviderOptions(detail),
					},
				],
			},
		],
	});

	return {
		path: relative(root.path, filePath),
		sizeBytes: fileStat.size,
		mediaType: media.mediaType,
		analysis: text,
	};
};

const describeImageForSearch = async ({
	filePath,
	fileStat,
	image,
	mediaType,
	query,
}) => {
	const cacheKey = buildImageCacheKey({ filePath, fileStat });
	const cached = imageMetadataCache.get(cacheKey);
	if (cached) {
		logLocalToolEvent("image_metadata_cache_hit", {
			path: filePath,
			sizeBytes: fileStat.size,
		});
		return {
			...cached,
			cached: true,
		};
	}

	if (fileStat.size > MAX_IMAGE_BYTES) {
		throw new Error("Image file is too large to index.");
	}

	const startedAt = Date.now();
	logLocalToolEvent("image_metadata_start", {
		path: filePath,
		sizeBytes: fileStat.size,
	});
	const { text } = await generateText({
		model: openai(DEFAULT_CHAT_MODEL_ID),
		providerOptions: getOpenAiModelProviderOptions(DEFAULT_CHAT_MODEL_ID, {
			reasoningEffort: "none",
		}),
		messages: [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: [
							"Create searchable metadata for this image.",
							"Include a concise title, a factual description, visible text/OCR if present, objects, people, UI elements, colors, and likely document/screenshot context.",
							query
								? `The user's image search query is: ${query}. Explicitly say whether the image appears to match it and why.`
								: "",
							"Do not invent details that are not visible.",
						]
							.filter(Boolean)
							.join(" "),
					},
					{
						type: "file",
						data: image,
						mediaType,
						providerOptions: createImageDetailProviderOptions("low"),
					},
				],
			},
		],
	});
	logLocalToolEvent("image_metadata_generated", {
		durationMs: Date.now() - startedAt,
		path: filePath,
		textLength: text.length,
	});
	const embeddingStartedAt = Date.now();
	const { embedding } = await embed({
		model: imageEmbeddingModel,
		value: text.replaceAll("\n", " "),
	});
	logLocalToolEvent("image_metadata_embedded", {
		durationMs: Date.now() - embeddingStartedAt,
		path: filePath,
	});
	const metadata = {
		description: text,
		embedding,
	};

	imageMetadataCache.set(cacheKey, metadata);

	return {
		...metadata,
		cached: false,
	};
};

const searchLocalImages = async ({
	maxResults = 5,
	query,
	relativePath = ".",
	rootIndex,
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
	const walkStartedAt = Date.now();
	await walkFiles({ directory: directoryPath, files, root });
	logLocalToolEvent("image_search_walk_complete", {
		durationMs: Date.now() - walkStartedAt,
		fileCount: files.length,
		path: directoryPath,
		query: needle,
	});

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
	const imagePaths = imageCandidates
		.slice(0, MAX_IMAGE_SEARCH_FILES)
		.map((candidate) => candidate.path);
	logLocalToolEvent("image_search_candidates", {
		candidateCount: imagePaths.length,
		candidates: imageCandidates
			.slice(0, MAX_IMAGE_SEARCH_FILES)
			.map((candidate) => ({
				path: candidate.path,
				pathScore: candidate.pathScore,
			})),
		maxCandidates: MAX_IMAGE_SEARCH_FILES,
		query: needle,
		queryTokens,
		totalImageCount,
		truncated: imagePaths.length < totalImageCount,
	});
	const queryEmbeddingStartedAt = Date.now();
	const { embedding: queryEmbedding } = await embed({
		model: imageEmbeddingModel,
		value: needle,
	});
	logLocalToolEvent("image_search_query_embedded", {
		durationMs: Date.now() - queryEmbeddingStartedAt,
		query: needle,
	});
	const results = [];
	let cachedMetadataCount = 0;

	for (const imagePath of imagePaths) {
		const imageStartedAt = Date.now();
		const { path: absolutePath } = await workspace.resolveExistingPath({
			relativePath: imagePath,
			rootIndex,
		});
		const fileData = await readEntireFile(absolutePath, {
			maxBytes: MAX_IMAGE_BYTES,
		}).catch(() => null);
		const fileStat = fileData?.fileStat ?? null;

		if (!fileStat?.isFile() || fileStat.size > MAX_IMAGE_BYTES) {
			logLocalToolEvent("image_search_candidate_skipped", {
				path: imagePath,
				reason: !fileStat?.isFile() ? "not a file" : "too large",
				sizeBytes: fileStat?.size,
			});
			continue;
		}

		const metadata = await describeImageForSearch({
			filePath: absolutePath,
			fileStat,
			image: fileData.buffer,
			mediaType:
				imageCandidates.find((candidate) => candidate.path === imagePath)
					?.mediaType ?? "application/octet-stream",
			query: needle,
		});
		if (metadata.cached) {
			cachedMetadataCount += 1;
		}

		const pathSimilarity = imagePath
			.toLowerCase()
			.includes(needle.toLowerCase())
			? 0.25
			: 0;
		const pathCandidateScore =
			imageCandidates.find((candidate) => candidate.path === imagePath)
				?.pathScore ?? 0;
		const descriptionScore = scoreImageDescriptionCandidate({
			description: metadata.description,
			queryTokens,
		});
		results.push({
			path: imagePath,
			sizeBytes: fileStat.size,
			score:
				cosineSimilarity(queryEmbedding, metadata.embedding) +
				pathSimilarity +
				pathCandidateScore / 100 +
				descriptionScore,
			description: metadata.description,
		});
		logLocalToolEvent("image_search_candidate_complete", {
			cached: metadata.cached,
			durationMs: Date.now() - imageStartedAt,
			path: imagePath,
			score: results.at(-1)?.score,
			sizeBytes: fileStat.size,
		});
	}

	const normalizedMaxResults = Math.min(
		Math.max(Number.parseInt(String(maxResults), 10) || 5, 1),
		MAX_IMAGE_SEARCH_RESULTS,
	);

	return {
		path: rootRelativePath,
		indexedImageCount: imagePaths.length,
		cachedMetadataCount,
		truncated:
			files.length >= MAX_WALK_FILES || imagePaths.length < totalImageCount,
		results: results
			.sort((left, right) => right.score - left.score)
			.slice(0, normalizedMaxResults)
			.map((result) => ({
				...result,
				score: Number(result.score.toFixed(4)),
			})),
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

export const buildLocalFolderTools = ({ executeLocalCommand, roots }) => {
	if (roots.length === 0) {
		return {};
	}
	if (typeof executeLocalCommand !== "function") {
		throw new Error("A local command executor is required.");
	}

	const workspace = createLocalWorkspaceSession(roots);
	const configs = buildLocalFolderToolConfigs(workspace.roots, {
		maxImageSearchResults: MAX_IMAGE_SEARCH_RESULTS,
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
			execute: async ({ detail, prompt, rootIndex, relativePath }) =>
				withDuration(() =>
					inspectLocalImage({
						detail,
						prompt,
						relativePath,
						rootIndex,
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
		maxImageSearchResults: MAX_IMAGE_SEARCH_RESULTS,
		providerOptions: deferredOpenAIToolOptions,
	});

	return Object.fromEntries(
		Object.entries(configs).map(([name, config]) => [name, tool(config)]),
	);
};
