import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type HostedRouteId,
	matchHostedRoutePath,
} from "@workspace/ai/hosted-route-catalog";
import type { Connect, Plugin } from "vite";
import { handleApplyTemplateRequest } from "./apply-template-handler.js";
import {
	handleChatReconnectRequest,
	handleChatRequest,
	handleChatStopRequest,
} from "./chat-handler.js";
import { handleEnhanceNoteRequest } from "./enhance-note-handler.js";
import { handleGenerateProjectDescriptionRequest } from "./generate-project-description-handler.js";
import {
	sendHostedRouteError,
	sendHostedRouteMethodNotAllowed,
} from "./hosted-route-response.js";
import { handleRealtimeTranscriptionSessionRequest } from "./realtime-transcription-session-handler.js";

type HostedApiHandler = (
	request: IncomingMessage,
	response: ServerResponse,
) => Promise<void>;
const hostedRouteHandlers = {
	applyTemplate: handleApplyTemplateRequest,
	chat: handleChatRequest,
	chatSteer: (request, response) =>
		handleChatRequest(request, response, { isSteerRoute: true }),
	chatStop: handleChatStopRequest,
	chatStream: handleChatReconnectRequest,
	enhanceNote: handleEnhanceNoteRequest,
	generateProjectDescription: handleGenerateProjectDescriptionRequest,
	realtimeTranscriptionSession: handleRealtimeTranscriptionSessionRequest,
} satisfies Record<HostedRouteId, HostedApiHandler>;

const getRequestPathname = (url: string | undefined) =>
	url?.split("?")[0] ?? "";

const createHostedApiMiddleware = (): Connect.NextHandleFunction => {
	return (request, response, next) => {
		const pathname = getRequestPathname(request.url);
		const route = matchHostedRoutePath(pathname);
		if (!route) {
			next();
			return;
		}

		if (request.method !== route.method) {
			sendHostedRouteMethodNotAllowed(response as ServerResponse);
			return;
		}

		const handler = hostedRouteHandlers[route.id];
		void handler(request as IncomingMessage, response as ServerResponse).catch(
			(error: unknown) => {
				sendHostedRouteError(response as ServerResponse, error);
			},
		);
	};
};

export const graneriHostedApiPlugin = (): Plugin => {
	const middleware = createHostedApiMiddleware();

	return {
		name: "graneri-hosted-api",
		configureServer(server) {
			server.middlewares.use(middleware);
		},
		configurePreviewServer(server) {
			server.middlewares.use(middleware);
		},
	};
};
