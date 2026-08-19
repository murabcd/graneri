import { z } from "zod";

export const MAX_LOCAL_FOLDER_ROOTS = 4;
export const MAX_LOCAL_FILE_READ_BYTES = 120_000;
export const MAX_LOCAL_COMMAND_LENGTH = 8_000;

export const buildLocalFolderSystemContext = (roots) =>
	roots.length === 0
		? ""
		: [
				"The user shared local folders from the desktop app. You can inspect only these shared folders through the local folder tools. Do not claim access to other local paths.",
				"When the user asks about a shared local path, folder contents, local file, screenshot, image, or text transcript file inside a shared folder, use the local folder tools before answering. Do not use connected app tools such as Notion for local filesystem questions unless the user explicitly asks about those connected apps.",
				"Do not say you cannot access the folder, and do not ask the user to run terminal commands, unless a local folder tool fails or the needed path is outside the shared folders.",
				"For broad read-only exploration, use run_local_command. It runs real non-interactive shell commands with the selected shared folder as its working directory. The macOS sandbox blocks writes, network access, and reads of user data outside that folder.",
				"Use structured local tools for direct folder listing, bounded text reads, and image inspection. Use read_local_file byte ranges when a text file is larger than one response.",
				"For local images, use inspect_local_image for a specific image and search_local_images when the user asks to find images by visual meaning, OCR text, screenshots, diagrams, or image contents.",
				"Shared local folders:",
				...roots.map((root, index) => `${index}: ${root.name} (${root.path})`),
			].join("\n");

export const buildLocalFolderToolConfigs = (
	roots,
	{ maxImageSearchResults = 10, providerOptions } = {},
) => {
	if (roots.length === 0) {
		return {};
	}

	const rootSchema = z
		.number()
		.int()
		.min(0)
		.max(Math.max(roots.length - 1, 0));
	const withProviderOptions = (config) =>
		providerOptions ? { ...config, providerOptions } : config;

	return {
		list_local_directory: withProviderOptions({
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
		read_local_file: withProviderOptions({
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
		inspect_local_image: withProviderOptions({
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
		}),
		search_local_images: withProviderOptions({
			description:
				"Semantically search images inside a local folder explicitly shared by the desktop user. Use this when the user asks to find screenshots, photos, diagrams, images containing text, or images matching a visual description.",
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
		}),
		search_local_files: withProviderOptions({
			description:
				"Search file names and text-like file contents inside a local folder explicitly shared by the desktop user.",
			inputSchema: z.object({
				rootIndex: rootSchema.describe(
					"Shared folder index from the system context.",
				),
				query: z.string().min(1).describe("Case-insensitive text to find."),
			}),
		}),
		run_local_command: withProviderOptions({
			description:
				"Run a real non-interactive shell command in one local folder explicitly shared by the desktop user. Use for bounded read-only exploration with system commands such as find, grep, stat, cat, head, tail, wc, sort, uniq, sed, awk, and jq. A macOS Seatbelt sandbox blocks filesystem writes, network access, and reads of user data outside the selected folder.",
			inputSchema: z.object({
				rootIndex: rootSchema.describe(
					"Shared folder index from the system context.",
				),
				command: z
					.string()
					.min(1)
					.max(MAX_LOCAL_COMMAND_LENGTH)
					.describe(
						"Read-only shell command to run from the selected shared folder.",
					),
			}),
		}),
		get_shared_local_folders: withProviderOptions({
			description: "Return the local folders shared with this chat request.",
			inputSchema: z.object({}),
		}),
	};
};
