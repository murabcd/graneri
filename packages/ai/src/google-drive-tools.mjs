import { z } from "zod";
import { buildAiToolSet, defineAiTool } from "./ai-tool-definition.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

export const buildGoogleDriveToolDefinitions = ({ searchFiles, getFile }) => [
	defineAiTool({
		name: "google_drive_search_files",
		description:
			"Search the connected Google Drive for documents, files, spreadsheets, and presentations by name or indexed content.",
		inputSchema: z.object({
			query: z.string().min(1),
			limit: z.number().int().min(1).max(10).optional(),
		}),
		policy: {
			access: "read",
			approval: "not_required",
			capability: "search",
			provider: "google-drive",
		},
		ui: toolUiMetadata.google_drive_search_files,
		execute: async ({ query, limit }) => await searchFiles({ query, limit }),
	}),
	defineAiTool({
		name: "google_drive_get_file",
		description:
			"Fetch metadata and a text excerpt for a specific Google Drive file by file ID when the user has already identified the file to inspect.",
		inputSchema: z.object({
			fileId: z.string().min(1),
		}),
		policy: {
			access: "read",
			approval: "not_required",
			capability: "read",
			provider: "google-drive",
		},
		ui: toolUiMetadata.google_drive_get_file,
		execute: async ({ fileId }) => await getFile({ fileId }),
	}),
];

export const buildGoogleDriveTools = (args) =>
	buildAiToolSet(buildGoogleDriveToolDefinitions(args));
