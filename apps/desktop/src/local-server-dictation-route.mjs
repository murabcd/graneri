import {
	DICTATION_AUDIO_CONTENT_TYPE,
	MAX_DICTATION_AUDIO_BYTES,
} from "@workspace/ai/dictation-policy";
import { getBearerTokenFromAuthorizationHeader } from "@workspace/ai/hosted-chat-http";
import { readBinaryBody, sendJson } from "./local-server-http.mjs";

const getConvexSiteUrl = () => {
	const value = process.env.CONVEX_SITE_URL?.trim();
	if (!value) {
		throw new Error("CONVEX_SITE_URL is not configured.");
	}

	return value.replace(/\/$/u, "");
};

export const createDictationTranscriptionRequestHandler =
	({ fetchImpl }) =>
	async (request, response) => {
		const convexToken = getBearerTokenFromAuthorizationHeader(
			request.headers.authorization,
		);
		if (!convexToken) {
			sendJson(response, 401, { error: "Authentication is required." });
			return;
		}

		const audio = await readBinaryBody(request, {
			maxBytes: MAX_DICTATION_AUDIO_BYTES,
		});
		if (audio.byteLength === 0) {
			sendJson(response, 400, { error: "Audio is required." });
			return;
		}

		const transcriptionResponse = await fetchImpl(
			`${getConvexSiteUrl()}/api/dictation-transcription`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${convexToken}`,
					"Content-Type": DICTATION_AUDIO_CONTENT_TYPE,
				},
				body: audio,
			},
		);
		const payload = await transcriptionResponse.json().catch(() => ({
			error: "Unable to transcribe audio.",
		}));
		const retryAfter = transcriptionResponse.headers.get("retry-after");
		sendJson(
			response,
			transcriptionResponse.status,
			payload,
			retryAfter ? { "Retry-After": retryAfter } : null,
		);
	};

export const handleDictationTranscriptionRequest =
	createDictationTranscriptionRequestHandler({ fetchImpl: fetch });
