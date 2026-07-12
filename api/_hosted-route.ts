import type { IncomingMessage, ServerResponse } from "node:http";
import {
	getHostedRouteDefinition,
	type HostedRouteId,
} from "@workspace/ai/hosted-route-catalog";
import {
	sendHostedRouteError,
	sendHostedRouteMethodNotAllowed,
} from "../apps/web/server/hosted-route-response.js";

export type HostedApiHandler = (
	request: IncomingMessage,
	response: ServerResponse,
) => Promise<void>;

export const handleHostedApiRoute = async ({
	handler,
	request,
	response,
	routeId,
}: {
	handler: HostedApiHandler;
	request: IncomingMessage;
	response: ServerResponse;
	routeId: HostedRouteId;
}) => {
	const route = getHostedRouteDefinition(routeId);
	if (request.method !== route.method) {
		sendHostedRouteMethodNotAllowed(response);
		return;
	}

	try {
		await handler(request, response);
	} catch (error) {
		sendHostedRouteError(response, error);
	}
};
