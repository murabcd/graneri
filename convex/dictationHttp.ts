import {
	getConvexErrorData,
	getConvexRetryAfterSeconds,
	isConvexErrorCode,
} from "@workspace/ai/convex-error";
import {
	DICTATION_AUDIO_CONTENT_TYPE,
	DICTATION_AUDIO_EXPIRATION_MS,
	MAX_DICTATION_AUDIO_BYTES,
} from "@workspace/ai/dictation-policy";
import { createSafetyIdentifier } from "@workspace/ai/safety-identifier";
import type { FunctionReturnType } from "convex/server";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

type DictationHttpPayload =
	| { error: string }
	| FunctionReturnType<typeof internal.dictationActions.transcribeStoredAudio>;

const jsonResponse = (
	status: number,
	payload: DictationHttpPayload,
	headers?: Record<string, string>,
) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: {
			"Content-Type": "application/json",
			...headers,
		},
	});

const getContentLength = (request: Request) => {
	const header = request.headers.get("content-length");
	if (header === null) {
		return null;
	}

	const value = Number(header);
	return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

export const handleDictationTranscriptionUploadRequest = async (
	ctx: ActionCtx,
	request: Request,
) => {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		return jsonResponse(401, { error: "Authentication is required." });
	}

	if (request.headers.get("content-type") !== DICTATION_AUDIO_CONTENT_TYPE) {
		return jsonResponse(415, { error: "Audio must be a WAV file." });
	}

	const contentLength = getContentLength(request);
	if (contentLength !== null && contentLength > MAX_DICTATION_AUDIO_BYTES) {
		return jsonResponse(413, { error: "Audio is too large." });
	}
	if (contentLength === 0) {
		return jsonResponse(400, { error: "Audio is required." });
	}

	try {
		await ctx.runMutation(internal.aiRateLimits.consumeDictation, {
			ownerTokenIdentifier: identity.tokenIdentifier,
		});
	} catch (error) {
		if (isConvexErrorCode(error, "AI_RATE_LIMITED")) {
			return jsonResponse(
				429,
				{ error: "Too many dictation requests. Please try again shortly." },
				{ "Retry-After": String(getConvexRetryAfterSeconds(error)) },
			);
		}
		throw error;
	}

	const audio = await request.blob();
	if (audio.size === 0) {
		return jsonResponse(400, { error: "Audio is required." });
	}
	if (audio.size > MAX_DICTATION_AUDIO_BYTES) {
		return jsonResponse(413, { error: "Audio is too large." });
	}
	const safetyIdentifier = await createSafetyIdentifier(
		identity.tokenIdentifier,
	);

	const storageId = await ctx.storage.store(audio);
	try {
		await ctx.scheduler.runAfter(
			DICTATION_AUDIO_EXPIRATION_MS,
			internal.dictationStorage.deleteStoredAudio,
			{ storageId },
		);
		const result = await ctx.runAction(
			internal.dictationActions.transcribeStoredAudio,
			{ safetyIdentifier, storageId },
		);
		return jsonResponse(200, result);
	} catch (error) {
		console.error("Dictation transcription failed", {
			code: getConvexErrorData(error)?.code ?? "TRANSCRIPTION_FAILED",
		});
		return jsonResponse(502, { error: "Unable to transcribe audio." });
	} finally {
		try {
			await ctx.runMutation(internal.dictationStorage.deleteStoredAudio, {
				storageId,
			});
		} catch (error) {
			console.error("Immediate dictation audio cleanup failed", { error });
		}
	}
};
