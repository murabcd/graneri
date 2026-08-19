import { z } from "zod";
import {
	inspectedLocalImageOutputForModel,
	MAX_LOCAL_IMAGE_UPLOADS,
	searchedLocalImagesOutputForModel,
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
				"Read a bounded UTF-8 text byte range from a file inside a local folder explicitly shared by the desktop user.",
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
			}),
		}),
		ui: {
			groupKey: "local-folder",
			icon: "file-text",
			running: "Reading local file",
			complete: "Read local file",
			subtitleKeys: ["relativePath"],
		},
	},
	inspect_local_image: {
		buildConfig: ({ rootSchema }) => ({
			description:
				"Inspect an image inside a local folder explicitly shared by the desktop user. Use this to describe a screenshot/photo/image, extract visible text, read charts, or answer questions about a specific image file.",
			inputSchema: z.object({
				rootIndex: rootSchema.describe(
					"Shared folder index from the system context.",
				),
				relativePath: z
					.string()
					.min(1)
					.describe("Image file path relative to the shared folder root."),
				prompt: z
					.string()
					.optional()
					.describe("Optional specific question to answer about the image."),
				detail: z
					.enum(["auto", "low", "high"])
					.default("auto")
					.describe("Image detail level. Use high for OCR or small UI text."),
			}),
			toModelOutput: inspectedLocalImageOutputForModel,
		}),
		ui: {
			groupKey: "local-folder",
			icon: "file-image",
			running: "Inspecting local image",
			complete: "Inspected local image",
			subtitleKeys: ["relativePath"],
		},
	},
	search_local_images: {
		buildConfig: ({ maxImageSearchResults, rootSchema }) => ({
			description:
				"Find and inspect candidate images inside a local folder explicitly shared by the desktop user. Use this when the user asks to find screenshots, photos, diagrams, images containing text, or images matching a visual description.",
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
					.describe("Semantic image search query or visible text to find."),
				maxResults: z
					.number()
					.int()
					.min(1)
					.max(maxImageSearchResults)
					.default(5)
					.describe("Maximum number of matching images to return."),
			}),
			toModelOutput: searchedLocalImagesOutputForModel,
		}),
		ui: {
			groupKey: "local-folder",
			icon: "file-image",
			running: "Searching local images",
			complete: "Searched local images",
			subtitleKeys: ["query"],
		},
	},
	search_local_files: {
		buildConfig: ({ rootSchema }) => ({
			description:
				"Search file names and text-like file contents inside a local folder explicitly shared by the desktop user.",
			inputSchema: z.object({
				rootIndex: rootSchema.describe(
					"Shared folder index from the system context.",
				),
				query: z.string().min(1).describe("Case-insensitive text to find."),
			}),
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
	get_shared_local_folders: {
		buildConfig: () => ({
			description: "Return the local folders shared with this chat request.",
			inputSchema: z.object({}),
		}),
		ui: {
			groupKey: "local-folder",
			icon: "folder",
			running: "Checking shared folders",
			complete: "Checked shared folders",
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
				"Use structured local tools for direct folder listing, bounded text reads, and image inspection. Use read_local_file byte ranges when a text file is larger than one response.",
				"For local images, use inspect_local_image for a specific image and search_local_images when the user asks to find images by visual meaning, OCR text, screenshots, diagrams, or image contents.",
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
