import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { handleArtifactWorkerCallback } from "./artifactAuthoringHttp";
import { authComponent, createAuth } from "./auth";
import { handleDictationTranscriptionUploadRequest } from "./dictationHttp";
import { handleJiraWebhookRequest } from "./jiraWebhook";
import { handleMcpOAuthCallbackRequest } from "./mcpOAuth";
import {
	handleNoteImageOptionsRequest,
	handleNoteImageUploadRequest,
} from "./noteImageHttp";
import { handleZoomOAuthCallbackRequest } from "./zoomOAuth";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth, { cors: true });

http.route({
	path: "/api/artifact-worker/callback",
	method: "POST",
	handler: httpAction(
		async (ctx, request) => await handleArtifactWorkerCallback(ctx, request),
	),
});

http.route({
	path: "/api/dictation-transcription",
	method: "POST",
	handler: httpAction(
		async (ctx, request) =>
			await handleDictationTranscriptionUploadRequest(ctx, request),
	),
});

http.route({
	path: "/api/note-images",
	method: "OPTIONS",
	handler: httpAction(async () => handleNoteImageOptionsRequest()),
});

http.route({
	path: "/api/note-images",
	method: "POST",
	handler: httpAction(
		async (ctx, request) => await handleNoteImageUploadRequest(ctx, request),
	),
});

http.route({
	path: "/api/webhooks/jira",
	method: "POST",
	handler: httpAction(
		async (ctx, request) => await handleJiraWebhookRequest(ctx, request),
	),
});

http.route({
	path: "/api/oauth/zoom/callback",
	method: "GET",
	handler: httpAction(
		async (ctx, request) => await handleZoomOAuthCallbackRequest(ctx, request),
	),
});

http.route({
	path: "/api/oauth/jira-mcp/callback",
	method: "GET",
	handler: httpAction(
		async (ctx, request) =>
			await handleMcpOAuthCallbackRequest(ctx, request, "jira-mcp"),
	),
});

http.route({
	path: "/api/oauth/figma/callback",
	method: "GET",
	handler: httpAction(
		async (ctx, request) =>
			await handleMcpOAuthCallbackRequest(ctx, request, "figma"),
	),
});

http.route({
	path: "/api/oauth/linear/callback",
	method: "GET",
	handler: httpAction(
		async (ctx, request) =>
			await handleMcpOAuthCallbackRequest(ctx, request, "linear"),
	),
});

http.route({
	path: "/api/oauth/notion/callback",
	method: "GET",
	handler: httpAction(
		async (ctx, request) =>
			await handleMcpOAuthCallbackRequest(ctx, request, "notion"),
	),
});

http.route({
	path: "/api/oauth/posthog/callback",
	method: "GET",
	handler: httpAction(
		async (ctx, request) =>
			await handleMcpOAuthCallbackRequest(ctx, request, "posthog"),
	),
});

export default http;
