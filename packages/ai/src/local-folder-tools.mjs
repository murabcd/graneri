import { tool } from "ai";
import {
	localCommandExecutionResultSchema,
	localProcessOutputSchema,
} from "./local-execution-contract.mjs";
import { MAX_LOCAL_FILE_UPLOADS } from "./local-folder-file-contract.mjs";
import {
	assertLocalFolderRootLimit,
	buildLocalFolderToolConfigs,
	MAX_LOCAL_FILE_READ_BYTES,
} from "./local-folder-tool-definitions.mjs";
import { listLocalSkills } from "./local-skills.mjs";
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
	cursor,
	maxResults = 5,
	query,
	relativePath = ".",
	rootIndex,
	storeLocalFile,
	workspace,
}) => {
	const searchResult = await workspace.searchImages({
		cursor,
		maxResults,
		query,
		relativePath,
		rootIndex,
	});
	const results = await Promise.all(
		searchResult.results.map(async (candidate) => {
			const storedImage = await storeLocalFile({
				bytes: candidate.bytes,
				mediaType: candidate.mediaType,
			});
			return {
				file: {
					filename: candidate.filename,
					mediaType: candidate.mediaType,
					storageId: storedImage.storageId,
				},
				path: candidate.path,
				sizeBytes: candidate.sizeBytes,
			};
		}),
	);

	return {
		candidateImageCount: results.length,
		kind: "image-search",
		path: searchResult.path,
		results,
		nextCursor: searchResult.nextCursor,
		visitedEntries: searchResult.visitedEntries,
		excludedEntries: searchResult.excludedEntries,
		skippedFiles: searchResult.skippedFiles,
	};
};

export const buildLocalFolderTools = ({
	downloadLocalFile,
	executeLocalCommand,
	executeLocalScript,
	interactLocalProcess,
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
	if (typeof downloadLocalFile !== "function")
		throw new Error("A local file download adapter is required.");

	if (
		typeof executeLocalScript !== "function" ||
		typeof interactLocalProcess !== "function"
	)
		throw new Error(
			"Local process execution and interaction adapters are required.",
		);

	const workspace = createLocalWorkspaceSession(roots);
	const configs = buildLocalFolderToolConfigs(workspace.roots, {
		maxImageSearchResults: MAX_LOCAL_FILE_UPLOADS,
		providerOptions: deferredOpenAIToolOptions,
	});
	const executors = {
		list_local_skills: (input) =>
			withDuration(() => listLocalSkills({ ...input, workspace })),
		run_local_script: async ({ rootIndex, relativePath, ...input }) =>
			withDuration(async () => {
				const { path, root } = await workspace.resolveExistingPath({
					rootIndex,
					relativePath,
				});
				return localProcessOutputSchema.parse(
					await executeLocalScript({
						...input,
						scriptPath: path,
						rootPath: root.path,
					}),
				);
			}),
		interact_local_process: async (input) =>
			withDuration(async () =>
				localProcessOutputSchema.parse(await interactLocalProcess(input)),
			),
		list_local_directory: async (input) =>
			withDuration(() => workspace.listDirectory(input)),
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
			cursor,
			contentType,
			maxResults,
			query,
			relativePath,
			rootIndex,
		}) =>
			withDuration(() =>
				contentType === "image"
					? searchLocalImages({
							cursor,
							maxResults,
							query,
							relativePath,
							rootIndex,
							storeLocalFile,
							workspace,
						})
					: workspace.searchFiles({ cursor, query, relativePath, rootIndex }),
			),
		save_local_file: async ({ rootIndex, relativePath, storageId }) =>
			withDuration(async () =>
				workspace.saveFile({
					bytes: await downloadLocalFile(storageId),
					relativePath,
					rootIndex,
				}),
			),
		run_local_command: async ({ rootIndex, command }) =>
			withDuration(async () =>
				localCommandExecutionResultSchema.parse(
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
	assertLocalFolderRootLimit(roots);

	const configs = buildLocalFolderToolConfigs(roots, {
		maxImageSearchResults: MAX_LOCAL_FILE_UPLOADS,
		providerOptions: deferredOpenAIToolOptions,
	});

	return Object.fromEntries(
		Object.entries(configs).map(([name, config]) => [name, tool(config)]),
	);
};
