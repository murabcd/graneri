import type { createRealtimeTranscriptionSession } from "../../../packages/ai/src/transcription.mjs";

type RealtimeTranscriptionSession = ReturnType<
	typeof createRealtimeTranscriptionSession
>;

export const requestOpenAiRealtimeClientSecret = ({
	apiKey,
	requestId,
	safetyIdentifier,
	session,
}: {
	apiKey: string;
	requestId: string;
	safetyIdentifier: string;
	session: RealtimeTranscriptionSession;
}) =>
	fetch("https://api.openai.com/v1/realtime/client_secrets", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			"OpenAI-Safety-Identifier": safetyIdentifier,
			"X-Client-Request-Id": requestId,
		},
		body: JSON.stringify({
			expires_after: {
				anchor: "created_at",
				seconds: 600,
			},
			session,
		}),
	});
