import type { IncomingMessage, ServerResponse } from "node:http";
import { getBearerTokenFromAuthorizationHeader } from "@workspace/ai/hosted-chat-http";
import { authorizeOpenAiRequest } from "@workspace/ai/openai-admission";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import { sendJson } from "./http-utils.js";

type HostedOpenAiOperation = "note-generation" | "realtime-session";

const authorizeOperation = (
	client: ConvexHttpClient,
	operation: HostedOpenAiOperation,
) => {
	switch (operation) {
		case "note-generation":
			return client.mutation(api.aiAccess.authorizeNoteGeneration);
		case "realtime-session":
			return client.mutation(api.aiAccess.authorizeRealtimeSession);
	}
};

const rateLimitErrors: Record<HostedOpenAiOperation, string> = {
	"note-generation":
		"Too many note generation requests. Please try again shortly.",
	"realtime-session":
		"Too many realtime session requests. Please try again shortly.",
};

export const authorizeHostedOpenAiRequest = async ({
	operation,
	request,
}: {
	operation: HostedOpenAiOperation;
	request: IncomingMessage;
}) => {
	const convexToken = getBearerTokenFromAuthorizationHeader(
		request.headers.authorization,
	);
	if (!convexToken) {
		return {
			error: "Authentication is required.",
			errorCode: "authentication_required" as const,
			ok: false as const,
			retryAfterSeconds: undefined,
			statusCode: 401 as const,
		};
	}

	const convexUrl = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
	if (!convexUrl) {
		throw new Error("CONVEX_URL is not configured.");
	}

	const client = new ConvexHttpClient(convexUrl, {
		auth: convexToken,
	});
	return await authorizeOpenAiRequest({
		authorize: () => authorizeOperation(client, operation),
		rateLimitError: rateLimitErrors[operation],
	});
};

type RejectedHostedOpenAiAdmission = Extract<
	Awaited<ReturnType<typeof authorizeHostedOpenAiRequest>>,
	{ ok: false }
>;

export const sendHostedOpenAiAdmissionError = (
	response: ServerResponse,
	admission: RejectedHostedOpenAiAdmission,
) => {
	sendJson(
		response,
		admission.statusCode,
		{ error: admission.error },
		admission.retryAfterSeconds === undefined
			? undefined
			: { "Retry-After": String(admission.retryAfterSeconds) },
	);
};

export const getOpenAiSafetyProviderOptions = (safetyIdentifier: string) => ({
	openai: { safetyIdentifier },
});
