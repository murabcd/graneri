import { z } from "zod";
import {
	MAX_LOCAL_FILE_UPLOADS,
	readLocalFileOutputForModel,
	saveLocalFileSourceSchema,
	searchLocalFilesOutputForModel,
} from "./local-folder-file-contract.mjs";

export const MAX_LOCAL_FOLDER_ROOTS = 1;
export const MAX_LOCAL_FILE_READ_BYTES = 120_000;
export const MAX_LOCAL_COMMAND_LENGTH = 8_000;

const cursorSchema = z
	.string()
	.min(1)
	.max(65_536)
	.optional()
	.describe(
		"Continuation cursor returned by the previous page. Keep the folder, query, and content type unchanged. Omit to restart if the folder changed.",
	);

export const assertLocalFolderRootLimit = (roots) => {
	if (roots.length > MAX_LOCAL_FOLDER_ROOTS) {
		throw new Error("Only one local folder can be shared.");
	}
};

const localFolderToolCatalog = Object.freeze({
	list_local_directory: {
		buildConfig: ({ rootSchema }) => ({
			description:
				"List files and folders inside a local folder explicitly shared by the desktop user.",
			inputSchema: z.object({
				cursor: cursorSchema,
				rootIndex: rootSchema.describe(
					"Shared folder index from the system context.",
				),
				relativePath: z
					.string()
					.default(".")
					.describe("Path relative to the shared folder root."),
			}),
		}),
		ui: {
			groupKey: "local-folder",
			icon: "folder-open",
			running: "Reading local folder",
			complete: "Read local folder",
			subtitleKeys: ["relativePath"],
		},
	},
	read_local_file: {
		buildConfig: ({ rootSchema }) => ({
			description:
				"Read a supported file inside a local folder explicitly shared by the desktop user. The file format is detected from its bytes. UTF-8 text returns a bounded byte range; images, PDF, DOCX, XLSX, and PPTX return model-readable file content.",
			inputSchema: z.object({
				rootIndex: rootSchema.describe(
					"Shared folder index from the system context.",
				),
				relativePath: z
					.string()
					.min(1)
					.describe("File path relative to the shared folder root."),
				offsetBytes: z
					.number()
					.int()
					.min(0)
					.default(0)
					.describe("Zero-based byte offset to start reading from."),
				lengthBytes: z
					.number()
					.int()
					.min(1)
					.max(MAX_LOCAL_FILE_READ_BYTES)
					.default(MAX_LOCAL_FILE_READ_BYTES)
					.describe("Maximum number of bytes to read."),
				prompt: z
					.string()
					.optional()
					.describe("Optional specific question to answer about the file."),
				detail: z
					.enum(["auto", "low", "high"])
					.default("auto")
					.describe(
						"Image detail level. Use high for OCR or small UI text; ignored for documents and text.",
					),
			}),
			toModelOutput: readLocalFileOutputForModel,
		}),
		ui: {
			groupKey: "local-folder",
			icon: "file-text",
			running: "Reading local file",
			complete: "Read local file",
			subtitleKeys: ["relativePath"],
		},
	},
	search_local_files: {
		buildConfig: ({ maxImageSearchResults, rootSchema }) => ({
			description:
				"Search files inside a local folder explicitly shared by the desktop user. Follow nextCursor until null for complete traversal. Text search matches filenames and UTF-8 contents; skippedFiles reports unsearched document, binary, or oversized contents. Image search returns consecutive pages of images for you to inspect against the query; it does not index OCR or visual meaning. Review skippedFiles and excludedEntries before claiming completeness.",
			inputSchema: z.object({
				cursor: cursorSchema,
				rootIndex: rootSchema.describe(
					"Shared folder index from the system context.",
				),
				relativePath: z
					.string()
					.default(".")
					.describe("Directory path relative to the shared folder root."),
				query: z
					.string()
					.min(1)
					.describe("Text, filename, visible text, or visual concept to find."),
				contentType: z
					.enum(["text", "image"])
					.default("text")
					.describe(
						"Search mode. Use image for screenshots, photos, charts, diagrams, OCR, or visual meaning.",
					),
				maxResults: z
					.number()
					.int()
					.min(1)
					.max(maxImageSearchResults)
					.default(5)
					.describe("Maximum number of image candidates to return."),
			}),
			toModelOutput: searchLocalFilesOutputForModel,
		}),
		ui: {
			groupKey: "local-folder",
			icon: "file-search",
			running: "Searching local files",
			complete: "Searched local files",
			subtitleKeys: ["query"],
		},
	},
	save_local_file: {
		buildConfig: ({ rootSchema }) => ({
			description:
				"Save a file from this chat to the shared local folder. Use the storageId in an attachment or generated artifact's providerMetadata.graneri. Creates a new file up to 50 MB without overwriting existing content; create its parent directory first with run_local_command if needed.",
			inputSchema: saveLocalFileSourceSchema.extend({ rootIndex: rootSchema }),
		}),
		ui: {
			groupKey: "local-folder",
			icon: "file-text",
			running: "Saving local file",
			complete: "Saved local file",
			subtitleKeys: ["relativePath"],
		},
	},
	run_local_command: {
		buildConfig: ({ rootSchema }) => ({
			description:
				"Run a cross-platform virtual Bash command in one local folder explicitly shared by the desktop user. Use built-in tools such as find, rg, grep, stat, cat, head, tail, wc, sort, uniq, sed, awk, jq, js-exec, python3, and sqlite3. Commands read and modify real files in the shared folder. Files persist between calls and app restarts; shell variables and processes do not. Inspect existing files before changing them and preserve unrelated user content. Reads outside the shared folder, symlink traversal, network access, and native host executables are unavailable.",
			inputSchema: z.object({
				rootIndex: rootSchema.describe(
					"Shared folder index from the system context.",
				),
				command: z
					.string()
					.min(1)
					.max(MAX_LOCAL_COMMAND_LENGTH)
					.describe(
						"Virtual Bash command to run from the selected shared folder.",
					),
			}),
		}),
		ui: {
			groupKey: "local-folder",
			icon: "terminal",
			running: "Running local command",
			complete: "Ran local command",
			subtitleKeys: ["command"],
		},
	},
});

export const LOCAL_FOLDER_TOOL_NAMES = Object.freeze(
	Object.keys(localFolderToolCatalog),
);

export const LOCAL_FOLDER_TOOL_UI_METADATA = Object.freeze(
	Object.fromEntries(
		Object.entries(localFolderToolCatalog).map(([name, definition]) => [
			name,
			definition.ui,
		]),
	),
);

export const buildLocalFolderSystemContext = (roots) =>
	roots.length === 0
		? ""
		: [
				"The user shared local folders from the desktop app. You can inspect only these shared folders through the local folder tools. Do not claim access to other local paths.",
				"When the user asks about a shared local path, folder contents, local file, screenshot, image, or text transcript file inside a shared folder, use the local folder tools before answering. Do not use connected app tools such as Notion for local filesystem questions unless the user explicitly asks about those connected apps.",
				"Do not say you cannot access the folder, and do not ask the user to run terminal commands, unless a local folder tool fails or the needed path is outside the shared folders.",
				"Use run_local_command to explore the folder, save scripts, and create or edit outputs. It runs cross-platform virtual Bash with the selected shared folder as its working directory. File changes persist between calls and app restarts; shell variables and processes do not. Inspect existing files before editing them, preserve unrelated user content, and report saved outputs using their relative paths. Reads outside the folder, symlink traversal, and native host executables are blocked. Network access is unavailable. Sandboxed JavaScript, sandboxed Python, and SQLite are available.",
				"Use structured local tools for direct folder listing, automatic supported-file reading, and file search. Continue list/search with nextCursor until null when complete coverage is needed. Hidden/generated entries are excluded and counted; skippedFiles identifies contents that were not searched. Open supported documents separately with read_local_file. read_local_file detects UTF-8 text, images, PDF, DOCX, XLSX, and PPTX from file bytes. Use byte ranges when a text file is larger than one response.",
				"For a specific local image or document, use read_local_file directly. Use search_local_files with contentType image when the user asks to find images by visual meaning, OCR text, screenshots, diagrams, or image contents.",
				"To save an attached or generated file into the shared folder, use save_local_file with its owned storageId and a new relative path. Existing files are not overwritten. Hosted artifact tools remain available for creating Office and PDF files; save their outputs locally when requested.",
				"Shared local folders:",
				...roots.map((root, index) => `${index}: ${root.name}`),
			].join("\n");

export const buildLocalFolderToolConfigs = (
	roots,
	{ maxImageSearchResults = MAX_LOCAL_FILE_UPLOADS, providerOptions } = {},
) => {
	if (roots.length === 0) {
		return {};
	}

	const rootSchema = z
		.number()
		.int()
		.min(0)
		.max(Math.max(roots.length - 1, 0));
	const context = { maxImageSearchResults, rootSchema };

	return Object.fromEntries(
		Object.entries(localFolderToolCatalog).map(([name, definition]) => {
			const config = definition.buildConfig(context);
			return [name, providerOptions ? { ...config, providerOptions } : config];
		}),
	);
};
