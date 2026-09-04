import type { IncomingMessage, ServerResponse } from "node:http";
import { handleClassifyMeetingEndRequest } from "../apps/web/server/classify-meeting-end-handler.js";
import { handleHostedApiRoute } from "./_hosted-route.js";

export default async function handler(
	request: IncomingMessage,
	response: ServerResponse,
) {
	await handleHostedApiRoute({
		handler: handleClassifyMeetingEndRequest,
		request,
		response,
		routeId: "classifyMeetingEnd",
	});
}
