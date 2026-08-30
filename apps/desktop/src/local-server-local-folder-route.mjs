import { MAX_LOCAL_FILE_UPLOADS } from "@workspace/ai/local-folder-file-contract";
import { isLocalFolderToolName } from "@workspace/ai/local-folder-tool-contract";
import { z } from "zod";
import { readJsonBody, sendJson } from "./local-server-http.mjs";

const localFolderToolRequestSchema = z.object({
	fileUploadUrls: z.array(z.url()).max(MAX_LOCAL_FILE_UPLOADS).default([]),
	input: z.unknown(),
	sessionId: z.string().min(1).max(128),
	toolCallId: z.string().min(1).max(512),
	toolName: z.string().refine(isLocalFolderToolName),
});

export const createLocalFolderToolRouteHandler = ({
	executeLocalFolderTool,
}) => {
	if (typeof executeLocalFolderTool !== "function") {
		throw new Error("Desktop local capability executor is required.");
	}

	return async (request, response) => {
		const parsedRequest = localFolderToolRequestSchema.safeParse(
			await readJsonBody(request),
		);
		if (!parsedRequest.success) {
			sendJson(response, 400, { error: "Invalid local tool request." });
			return;
		}
		const output = await executeLocalFolderTool(parsedRequest.data);
		sendJson(response, 200, { output });
	};
};
