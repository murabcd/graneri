import type { IncomingMessage, ServerResponse } from "node:http";
import { handleGenerateProjectDescriptionRequest } from "../apps/web/server/generate-project-description-handler.js";
import { handleHostedApiRoute } from "./_hosted-route.js";

export default async function handler(
	request: IncomingMessage,
	response: ServerResponse,
) {
	await handleHostedApiRoute({
		handler: handleGenerateProjectDescriptionRequest,
		request,
		response,
		routeId: "generateProjectDescription",
	});
}
