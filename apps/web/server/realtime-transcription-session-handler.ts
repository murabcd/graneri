import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	createRealtimeTranscriptionSession,
	createRealtimeTranscriptionSessionOptions,
	normalizeTranscriptionLanguage,
} from "../../../packages/ai/src/transcription.mjs";
import {
	authorizeHostedOpenAiRequest,
	sendHostedOpenAiAdmissionError,
} from "./hosted-openai-admission.js";
import { readJsonBody, sendJson } from "./http-utils.js";
import { requestOpenAiRealtimeClientSecret } from "./openai-realtime-session-client.js";
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
		headers,
		statusCode,
	}: {
		error: string;
		errorCode: string;
		headers?: Record<string, string>;
		statusCode: number;
	}) => {
		wideEvent.outcome = "error";
		wideEvent.status_code = statusCode;
		wideEvent.error_code = errorCode;
		emitServerWideEvent({ event: wideEvent, level: "error", startedAt });
		sendJson(response, statusCode, { error }, headers);
	};
	const admission = await authorizeHostedOpenAiRequest({
		operation: "realtime-session",
		request,
	});
	if (!admission.ok) {
		wideEvent.outcome = "error";
		wideEvent.status_code = admission.statusCode;
		wideEvent.error_code = admission.errorCode;
		emitServerWideEvent({ event: wideEvent, level: "error", startedAt });
		sendHostedOpenAiAdmissionError(response, admission);
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

	const sessionResponse = await requestOpenAiRealtimeClientSecret({
		apiKey: process.env.OPENAI_API_KEY,
		requestId,
		safetyIdentifier: admission.safetyIdentifier,
		session: createRealtimeTranscriptionSession(
			createRealtimeTranscriptionSessionOptions({
				language,
				source: normalizedSource,
				speaker,
			}),
		),
	});

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
