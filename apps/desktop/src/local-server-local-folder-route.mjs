import { MAX_LOCAL_IMAGE_UPLOADS } from "@workspace/ai/local-folder-image-contract";
import { isLocalFolderToolName } from "@workspace/ai/local-folder-tool-contract";
import { MAX_LOCAL_FOLDER_ROOTS } from "@workspace/ai/local-folder-tool-definitions";
import { buildLocalFolderTools } from "@workspace/ai/local-folder-tools";
import { z } from "zod";
import { runLocalCommand } from "./local-command-runner.mjs";
import { createLocalImageStore } from "./local-image-storage.mjs";
import { readJsonBody, sendJson } from "./local-server-http.mjs";

const localFolderToolRequestSchema = z.object({
	imageUploadUrls: z.array(z.url()).max(MAX_LOCAL_IMAGE_UPLOADS).default([]),
	input: z.unknown(),
	localFolders: z
		.array(
			z.object({
				id: z.string().min(1),
			}),
		)
		.min(1)
		.max(MAX_LOCAL_FOLDER_ROOTS),
	toolCallId: z.string().min(1),
	toolName: z.string().refine(isLocalFolderToolName),
});

export const createLocalFolderToolRouteHandler = ({
	getSharedLocalFolders,
}) => {
	if (typeof getSharedLocalFolders !== "function") {
		throw new Error("Desktop shared-folder lookup is required.");
	}

	return async (request, response) => {
		const parsedRequest = localFolderToolRequestSchema.safeParse(
			await readJsonBody(request),
		);
		if (!parsedRequest.success) {
			sendJson(response, 400, { error: "Invalid local tool request." });
			return;
		}
		const { imageUploadUrls, input, localFolders, toolCallId, toolName } =
			parsedRequest.data;
		const localFolderRoots = getSharedLocalFolders(
			localFolders.map(({ id }) => id),
		);

		const toolToExecute = buildLocalFolderTools({
			executeLocalCommand: runLocalCommand,
			roots: localFolderRoots,
			storeLocalImage: createLocalImageStore({
				uploadUrls: imageUploadUrls,
			}),
		})[toolName];

		if (!toolToExecute?.execute) {
			sendJson(response, 400, { error: `Unknown local tool: ${toolName}.` });
			return;
		}

		const parsedInput = await toolToExecute.inputSchema.parseAsync(input);
		const output = await toolToExecute.execute(parsedInput, {
			messages: [],
			toolCallId,
		});
		sendJson(response, 200, { output });
	};
};
