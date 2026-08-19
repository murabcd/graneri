import { tool } from "ai";
import { MAX_LOCAL_IMAGE_UPLOADS } from "./local-folder-image-contract.mjs";
import {
	buildLocalFolderToolConfigs,
	MAX_LOCAL_FOLDER_ROOTS,
} from "./local-folder-tool-definitions.mjs";
import { createLocalWorkspaceSession } from "./local-workspace-session.mjs";

export { buildLocalFolderSystemContext } from "./local-folder-tool-definitions.mjs";

const deferredOpenAIToolOptions = {
	openai: {
		deferLoading: true,
	},
};

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

const inspectLocalImage = async ({
	relativePath,
	rootIndex,
	storeLocalImage,
	workspace,
}) => {
	const image = await workspace.readImage({
		relativePath,
		rootIndex,
	});
	const storedImage = await storeLocalImage({
		bytes: image.bytes,
		mediaType: image.mediaType,
	});

	return {
		file: {
			filename: image.filename,
			mediaType: image.mediaType,
			storageId: storedImage.storageId,
		},
		path: image.path,
		sizeBytes: image.sizeBytes,
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
	const searchResult = await workspace.searchImages({
		maxResults,
		query,
		relativePath,
		rootIndex,
	});
	const results = [];

	for (const candidate of searchResult.results) {
		const storedImage = await storeLocalImage({
			bytes: candidate.bytes,
			mediaType: candidate.mediaType,
		});
		results.push({
			file: {
				filename: candidate.filename,
				mediaType: candidate.mediaType,
				storageId: storedImage.storageId,
			},
			path: candidate.path,
			sizeBytes: candidate.sizeBytes,
		});
	}

	return {
		candidateImageCount: results.length,
		path: searchResult.path,
		results,
		totalImageCount: searchResult.totalImageCount,
		truncated: searchResult.truncated,
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
					workspace.listDirectory({ relativePath, rootIndex }),
				),
		}),
		read_local_file: tool({
			...configs.read_local_file,
			execute: async ({ lengthBytes, offsetBytes, rootIndex, relativePath }) =>
				withDuration(() =>
					workspace.readTextFile({
						lengthBytes,
						offsetBytes,
						relativePath,
						rootIndex,
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
				withDuration(() => workspace.searchFiles({ query, rootIndex })),
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
