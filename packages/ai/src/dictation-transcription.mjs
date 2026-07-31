import { MAX_DICTATION_AUDIO_BYTES } from "./dictation-policy.mjs";
import { DICTATION_TRANSCRIPTION_MODEL } from "./transcription.mjs";

const OPENAI_TRANSCRIPTIONS_URL =
	"https://api.openai.com/v1/audio/transcriptions";

const getDurationInSeconds = (usage) =>
	usage?.type === "duration" &&
	typeof usage.seconds === "number" &&
	Number.isFinite(usage.seconds)
		? usage.seconds
		: null;

const getDetectedLanguages = (languages) => {
	if (
		!Array.isArray(languages) ||
		languages.some(
			(language) =>
				typeof language !== "object" ||
				language === null ||
				typeof language.code !== "string",
		)
	) {
		throw new Error("Transcription response is missing detected languages.");
	}

	return languages.map(({ code }) => code);
};

const getApiKey = (value) => {
	const apiKey = value?.trim();
	if (!apiKey) {
		throw new Error("OPENAI_API_KEY is not configured.");
	}

	return apiKey;
};

const getTranscriptionResult = async (response) => {
	if (!response.ok) {
		throw new Error(
			`OpenAI transcription request failed with status ${response.status}.`,
		);
	}

	const result = await response.json();
	if (
		typeof result !== "object" ||
		result === null ||
		typeof result.text !== "string"
	) {
		throw new Error("Transcription response is missing text.");
	}

	return result;
};

export const createDictationAudioTranscriber = ({
	apiKey,
	fetch: fetchImpl,
}) => {
	const authorization = `Bearer ${getApiKey(apiKey)}`;
	if (typeof fetchImpl !== "function") {
		throw new Error("A fetch implementation is required.");
	}

	return async ({ audio, safetyIdentifier }) => {
		if (!(audio instanceof Uint8Array) || audio.byteLength === 0) {
			throw new Error("Audio is required.");
		}

		if (audio.byteLength > MAX_DICTATION_AUDIO_BYTES) {
			throw new Error("Audio is too large.");
		}
		if (typeof safetyIdentifier !== "string" || safetyIdentifier.length === 0) {
			throw new Error("A safety identifier is required.");
		}

		const formData = new FormData();
		formData.append(
			"file",
			new Blob([audio], { type: "audio/wav" }),
			"dictation.wav",
		);
		formData.append("model", DICTATION_TRANSCRIPTION_MODEL);
		formData.append("response_format", "json");

		const response = await fetchImpl(OPENAI_TRANSCRIPTIONS_URL, {
			method: "POST",
			headers: {
				Authorization: authorization,
				"OpenAI-Safety-Identifier": safetyIdentifier,
			},
			body: formData,
		});
		const result = await getTranscriptionResult(response);

		return {
			durationInSeconds: getDurationInSeconds(result.usage),
			languages: getDetectedLanguages(result.languages),
			text: result.text.trim(),
		};
	};
};

export const transcribeDictationAudio = (options) =>
	createDictationAudioTranscriber({
		apiKey: process.env.OPENAI_API_KEY,
		fetch: globalThis.fetch,
	})(options);
