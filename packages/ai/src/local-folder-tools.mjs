import { tool } from "ai";
import { MAX_LOCAL_FILE_UPLOADS } from "./local-folder-file-contract.mjs";
import { parseLocalCommandExecutionResult } from "./local-folder-tool-contract.mjs";
import {
	buildLocalFolderToolConfigs,
	MAX_LOCAL_FILE_READ_BYTES,
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

const storeWorkspaceFile = async ({
	lengthBytes,
	offsetBytes,
	relativePath,
	rootIndex,
	storeLocalFile,
	workspace,
}) => {
	const result = await workspace.readFile({
		lengthBytes,
		offsetBytes,
		relativePath,
		rootIndex,
	});
	if (result.kind === "text") {
		return result;
	}
	const storedFile = await storeLocalFile({
		bytes: result.bytes,
		mediaType: result.mediaType,
	});

	return {
		file: {
			filename: result.filename,
			mediaType: result.mediaType,
			storageId: storedFile.storageId,
		},
		kind: "file",
		path: result.path,
		sizeBytes: result.sizeBytes,
	};
};

const searchLocalImages = async ({
	maxResults = 5,
	query,
	relativePath = ".",
	rootIndex,
	storeLocalFile,
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
		const storedImage = await storeLocalFile({
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
		kind: "image-search",
		path: searchResult.path,
		results,
		totalImageCount: searchResult.totalImageCount,
		truncated: searchResult.truncated,
	};
};

export const buildLocalFolderTools = ({
	executeLocalCommand,
	roots,
	storeLocalFile,
}) => {
	if (roots.length === 0) {
		return {};
	}
	if (typeof executeLocalCommand !== "function") {
		throw new Error("A local command executor is required.");
	}
	if (typeof storeLocalFile !== "function") {
		throw new Error("A local file storage adapter is required.");
	}

	const workspace = createLocalWorkspaceSession(roots);
	const configs = buildLocalFolderToolConfigs(workspace.roots, {
		maxImageSearchResults: MAX_LOCAL_FILE_UPLOADS,
		providerOptions: deferredOpenAIToolOptions,
	});
	const executors = {
		list_local_directory: async ({ rootIndex, relativePath }) =>
			withDuration(() => workspace.listDirectory({ relativePath, rootIndex })),
		read_local_file: async ({
			lengthBytes = MAX_LOCAL_FILE_READ_BYTES,
			offsetBytes = 0,
			rootIndex,
			relativePath,
		}) =>
			withDuration(() =>
				storeWorkspaceFile({
					lengthBytes,
					offsetBytes,
					relativePath,
					rootIndex,
					storeLocalFile,
					workspace,
				}),
			),
		search_local_files: async ({
			contentType,
			maxResults,
			query,
			relativePath,
			rootIndex,
		}) =>
			withDuration(() =>
				contentType === "image"
					? searchLocalImages({
							maxResults,
							query,
							relativePath,
							rootIndex,
							storeLocalFile,
							workspace,
						})
					: workspace.searchFiles({ query, relativePath, rootIndex }),
			),
		run_local_command: async ({ rootIndex, command }) =>
			withDuration(async () =>
				parseLocalCommandExecutionResult(
					await executeLocalCommand({
						command,
						rootPath: workspace.getRoot(rootIndex).path,
					}),
				),
			),
	};

	return Object.fromEntries(
		Object.entries(configs).map(([name, config]) => {
			const execute = executors[name];
			if (!execute) {
				throw new Error(`Local folder tool ${name} has no desktop executor.`);
			}
			return [name, tool({ ...config, execute })];
		}),
	);
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
		maxImageSearchResults: MAX_LOCAL_FILE_UPLOADS,
		providerOptions: deferredOpenAIToolOptions,
	});

	return Object.fromEntries(
		Object.entries(configs).map(([name, config]) => [name, tool(config)]),
	);
};
