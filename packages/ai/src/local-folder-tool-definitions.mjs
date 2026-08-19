import { z } from "zod";
import {
	MAX_LOCAL_IMAGE_UPLOADS,
	readLocalFileOutputForModel,
	searchLocalFilesOutputForModel,
} from "./local-folder-image-contract.mjs";

export const MAX_LOCAL_FOLDER_ROOTS = 4;
export const MAX_LOCAL_FILE_READ_BYTES = 120_000;
export const MAX_LOCAL_COMMAND_LENGTH = 8_000;

const localFolderToolCatalog = Object.freeze({
	list_local_directory: {
		buildConfig: ({ rootSchema }) => ({
			description:
				"List files and folders inside a local folder explicitly shared by the desktop user.",
			inputSchema: z.object({
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
				"Read a text file or inspect an image inside a local folder explicitly shared by the desktop user. Text reads return a bounded UTF-8 byte range. Image reads return multimodal content for screenshots, photos, charts, diagrams, and OCR.",
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
				contentType: z
					.enum(["text", "image"])
					.default("text")
					.describe(
						"Content to read. Use image for screenshots, photos, charts, diagrams, or OCR.",
					),
				prompt: z
					.string()
					.optional()
					.describe("Optional specific question to answer about an image."),
				detail: z
					.enum(["auto", "low", "high"])
					.default("auto")
					.describe("Image detail level. Use high for OCR or small UI text."),
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
				"Search files inside a local folder explicitly shared by the desktop user. Text search matches file names and text-like contents. Image search finds and inspects candidate screenshots, photos, charts, diagrams, visible text, or visual descriptions.",
			inputSchema: z.object({
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
	run_local_command: {
		buildConfig: ({ rootSchema }) => ({
			description:
				"Run a cross-platform virtual Bash command in one local folder explicitly shared by the desktop user. Use built-in tools such as find, rg, grep, stat, cat, head, tail, wc, sort, uniq, sed, awk, jq, curl, js-exec, python3, and sqlite3. Commands can read the live shared folder; writes are temporary copy-on-write changes discarded after the call. Reads outside the shared folder, symlink traversal, and private-network access are blocked. Public HTTP(S) requests are allowed. Native host executables are unavailable.",
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
			running: "Exploring local folder",
			complete: "Explored local folder",
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
				"For broad exploration, use run_local_command. It runs cross-platform virtual Bash with the selected shared folder as its working directory. Reads reflect the live shared folder; writes are temporary copy-on-write changes discarded after the call. Reads outside the folder, symlink traversal, private-network access, and native host executables are blocked. Public HTTP(S) requests, sandboxed JavaScript, sandboxed Python, and in-memory SQLite are available.",
				"Use structured local tools for direct folder listing, bounded text reads, image inspection, and file search. Use read_local_file byte ranges when a text file is larger than one response.",
				"For local images, use read_local_file with contentType image for a specific image and search_local_files with contentType image when the user asks to find images by visual meaning, OCR text, screenshots, diagrams, or image contents.",
				"Shared local folders:",
				...roots.map((root, index) => `${index}: ${root.name} (${root.path})`),
			].join("\n");

export const buildLocalFolderToolConfigs = (
	roots,
	{ maxImageSearchResults = MAX_LOCAL_IMAGE_UPLOADS, providerOptions } = {},
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
