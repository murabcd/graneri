import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import { MAX_DICTATION_AUDIO_BYTES } from "../../../packages/ai/src/dictation-transcription.mjs";
import { getBearerTokenFromAuthorizationHeader } from "../../../packages/ai/src/hosted-chat-http.mjs";
import { readBinaryBody, sendJson } from "./local-server-http.mjs";

const getConvexUrl = () => {
	const value = process.env.CONVEX_URL?.trim();
	if (!value) {
		throw new Error("CONVEX_URL is not configured.");
	}

	return value;
};

const readStorageId = async (response) => {
	const payload = await response.json().catch(() => null);
	const storageId =
		payload &&
		typeof payload === "object" &&
		typeof payload.storageId === "string"
			? payload.storageId
			: "";

	if (!response.ok || !storageId) {
		throw new Error("Failed to upload dictation audio.");
	}

	return storageId;
};

export const handleDictationTranscriptionRequest = async (
	request,
	response,
) => {
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

	const client = new ConvexHttpClient(getConvexUrl(), { auth: convexToken });
	const uploadUrl = await client.mutation(
		api.dictationUploads.generateUploadUrl,
	);
	const uploadResponse = await fetch(uploadUrl, {
		method: "POST",
		headers: {
			"Content-Type": "audio/wav",
		},
		body: audio,
	});
	const storageId = await readStorageId(uploadResponse);
	const uploadId = await client.mutation(api.dictationUploads.register, {
		storageId,
	});

	try {
		const result = await client.action(api.dictationActions.transcribe, {
			uploadId,
		});
		sendJson(response, 200, result);
	} catch (error) {
		await client
			.mutation(api.dictationUploads.cancel, { uploadId })
			.catch(() => undefined);
		throw error;
	}
};
