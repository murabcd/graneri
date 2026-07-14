import type { ServerResponse } from "node:http";
import { getHostedChatConvexRouteError } from "@workspace/ai/hosted-chat-runtime";

const sendJson = (
	response: ServerResponse,
	statusCode: number,
	payload: Record<string, string>,
) => {
	response.statusCode = statusCode;
	response.setHeader("Content-Type", "application/json");
	response.end(JSON.stringify(payload));
};

export const sendHostedRouteMethodNotAllowed = (response: ServerResponse) => {
	sendJson(response, 405, { error: "Method not allowed." });
};

export const sendHostedRouteError = (
	response: ServerResponse,
	error: unknown,
) => {
	const routeError = getHostedChatConvexRouteError(error);
	if (routeError) {
		sendJson(response, routeError.statusCode, {
			error: routeError.error,
			errorCode: routeError.errorCode,
		});
		return;
	}

	const message =
		error instanceof Error ? error.message : "Unexpected server error.";
	sendJson(response, 500, { error: message });
};
