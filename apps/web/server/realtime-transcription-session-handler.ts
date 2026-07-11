import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import { isConvexErrorCode } from "../../../packages/ai/src/convex-error.mjs";
import { getBearerTokenFromAuthorizationHeader } from "../../../packages/ai/src/hosted-chat-http.mjs";
import {
	createRealtimeTranscriptionSession,
	createRealtimeTranscriptionSessionOptions,
	normalizeTranscriptionLanguage,
} from "../../../packages/ai/src/transcription.mjs";
import { readJsonBody, sendJson } from "./http-utils.js";
import { createServerWideEvent, emitServerWideEvent } from "./server-logger.js";

type RealtimeSessionRequestBody = {
	lang?: string;
	speaker?: string;
	source?: string;
};

const trim = (value: unknown) =>
	typeof value === "string" ? value.trim() : undefined;

export const handleRealtimeTranscriptionSessionRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
) => {
	const startedAt = Date.now();
	const wideEvent = createServerWideEvent({
		event: "realtime_transcription_session.request",
		request,
	});
	const sendError = ({
		error,
		errorCode,
		statusCode,
	}: {
		error: string;
		errorCode: string;
		statusCode: number;
	}) => {
		wideEvent.outcome = "error";
		wideEvent.status_code = statusCode;
		wideEvent.error_code = errorCode;
		emitServerWideEvent({ event: wideEvent, level: "error", startedAt });
		sendJson(response, statusCode, { error });
	};
	const convexToken = getBearerTokenFromAuthorizationHeader(
		request.headers.authorization,
	);

	if (!convexToken) {
		sendError({
			error: "Authentication is required.",
			errorCode: "authentication_required",
			statusCode: 401,
		});
		return;
	}

	const convexUrl = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
	if (!convexUrl) {
		throw new Error("CONVEX_URL is not configured.");
	}

	try {
		const convexClient = new ConvexHttpClient(convexUrl, { auth: convexToken });
		await convexClient.query(api.aiAccess.verify);
	} catch (error) {
		if (isConvexErrorCode(error, "UNAUTHENTICATED")) {
			sendError({
				error: "Authentication is invalid.",
				errorCode: "authentication_invalid",
				statusCode: 401,
			});
			return;
		}

		sendError({
			error: "Authentication service is unavailable.",
			errorCode: "authentication_service_unavailable",
			statusCode: 503,
		});
		return;
	}

	if (!process.env.OPENAI_API_KEY) {
		sendError({
			error: "OPENAI_API_KEY is not configured.",
			errorCode: "openai_api_key_missing",
			statusCode: 500,
		});
		return;
	}

	const {
		lang,
		source,
		speaker: rawSpeaker,
	} = await readJsonBody<RealtimeSessionRequestBody>(request);
	const language = normalizeTranscriptionLanguage(lang);
	const requestId = randomUUID();
	const speaker = trim(rawSpeaker);
	const normalizedSource = trim(source);
	wideEvent.request_id = requestId;
	wideEvent.language = language;
	wideEvent.has_speaker = Boolean(speaker);
	wideEvent.source = normalizedSource ?? null;

	const sessionResponse = await fetch(
		"https://api.openai.com/v1/realtime/client_secrets",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
				"Content-Type": "application/json",
				"X-Client-Request-Id": requestId,
			},
			body: JSON.stringify({
				expires_after: {
					anchor: "created_at",
					seconds: 600,
				},
				session: createRealtimeTranscriptionSession(
					createRealtimeTranscriptionSessionOptions({
						language,
						source: normalizedSource,
						speaker,
					}),
				),
			}),
		},
	);

	wideEvent.openai_request_id = sessionResponse.headers.get("x-request-id");
	wideEvent.openai_processing_ms = sessionResponse.headers.get(
		"openai-processing-ms",
	);
	wideEvent.openai_status_code = sessionResponse.status;

	const payload = (await sessionResponse.json().catch(() => ({}))) as {
		error?: {
			message?: string;
		};
		value?: string;
	};

	if (!sessionResponse.ok) {
		const error =
			payload.error?.message ||
			"Failed to create realtime transcription session.";
		wideEvent.error_message = error;
		sendError({
			error,
			errorCode: "openai_session_failed",
			statusCode: sessionResponse.status,
		});
		return;
	}

	const clientSecret = payload.value;

	if (!clientSecret) {
		sendError({
			error: "OpenAI did not return a client secret.",
			errorCode: "client_secret_missing",
			statusCode: 500,
		});
		return;
	}

	wideEvent.outcome = "success";
	wideEvent.status_code = 200;
	emitServerWideEvent({ event: wideEvent, startedAt });
	sendJson(response, 200, {
		clientSecret,
	});
};
