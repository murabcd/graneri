import type { IncomingMessage, ServerResponse } from "node:http";
import { getBearerTokenFromAuthorizationHeader } from "@workspace/ai/hosted-chat-http";
import { authorizeOpenAiRequest } from "@workspace/ai/openai-admission";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import { sendJson } from "./http-utils.js";

type HostedOpenAiOperation =
	| "chat-turn"
	| "note-generation"
	| "realtime-session";

const authorizeOperation = (
	client: ConvexHttpClient,
	operation: HostedOpenAiOperation,
) => {
	switch (operation) {
		case "chat-turn":
			return client.mutation(api.aiAccess.authorizeChatTurn);
		case "note-generation":
			return client.mutation(api.aiAccess.authorizeNoteGeneration);
		case "realtime-session":
			return client.mutation(api.aiAccess.authorizeRealtimeSession);
	}
};

const rateLimitErrors: Record<HostedOpenAiOperation, string> = {
	"chat-turn": "Too many chat requests. Please try again shortly.",
	"note-generation":
		"Too many note generation requests. Please try again shortly.",
	"realtime-session":
		"Too many realtime session requests. Please try again shortly.",
};

const authorizeHostedOpenAiRequest = async ({
	client,
	operation,
	request,
}: {
	client?: ConvexHttpClient;
	operation: HostedOpenAiOperation;
	request: IncomingMessage;
}) => {
	let authorizationClient = client;
	if (!authorizationClient) {
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

		authorizationClient = new ConvexHttpClient(convexUrl, {
			auth: convexToken,
		});
	}

	return await authorizeOpenAiRequest({
		authorize: () => authorizeOperation(authorizationClient, operation),
		rateLimitError: rateLimitErrors[operation],
	});
};

type HostedOpenAiRejection = {
	error: string;
	errorCode: string;
	retryAfterSeconds?: number;
	statusCode: number;
};

type HostedOpenAiAdmissionBase = {
	onRejected: (rejection: HostedOpenAiRejection) => void;
	request: IncomingMessage;
	response: ServerResponse;
};

type HostedOpenAiAdmissionRequest = HostedOpenAiAdmissionBase &
	(
		| {
				client: ConvexHttpClient;
				operation: "chat-turn";
		  }
		| {
				client?: never;
				operation: Exclude<HostedOpenAiOperation, "chat-turn">;
		  }
	);

export const admitHostedOpenAiRequest = async ({
	client,
	onRejected,
	operation,
	request,
	response,
}: HostedOpenAiAdmissionRequest) => {
	const admission = await authorizeHostedOpenAiRequest({
		client,
		operation,
		request,
	});
	if (!admission.ok) {
		onRejected(admission);
		const payload =
			operation === "chat-turn"
				? { error: admission.error, errorCode: admission.errorCode }
				: { error: admission.error };
		sendJson(
			response,
			admission.statusCode,
			payload,
			admission.retryAfterSeconds === undefined
				? undefined
				: { "Retry-After": String(admission.retryAfterSeconds) },
		);
		return null;
	}

	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		const rejection = {
			error: "OPENAI_API_KEY is not configured.",
			errorCode: "openai_api_key_missing",
			statusCode: 500,
		};
		onRejected(rejection);
		sendJson(response, rejection.statusCode, {
			error: rejection.error,
		});
		return null;
	}

	return {
		apiKey,
		safetyIdentifier: admission.safetyIdentifier,
	};
};

export const getOpenAiSafetyProviderOptions = (safetyIdentifier: string) => ({
	openai: { safetyIdentifier },
});
