import { openai } from "@ai-sdk/openai";
import { transcribe } from "ai";
import { MAX_DICTATION_AUDIO_BYTES } from "./dictation-policy.mjs";
import {
	DICTATION_TRANSCRIPTION_MODEL,
	normalizeTranscriptionLanguage,
} from "./transcription.mjs";

const MAX_DICTATION_PROMPT_LENGTH = 1_000;

const trim = (value) => (typeof value === "string" ? value.trim() : "");

const buildOpenAIOptions = ({ language, prompt }) => {
	const options = {};
	const normalizedLanguage = normalizeTranscriptionLanguage(language);
	const normalizedPrompt = trim(prompt).slice(0, MAX_DICTATION_PROMPT_LENGTH);

	if (normalizedLanguage) {
		options.language = normalizedLanguage;
	}

	if (normalizedPrompt) {
		options.prompt = normalizedPrompt;
	}

	return options;
};

export const transcribeDictationAudio = async ({
	audio,
	language = null,
	prompt = null,
	safetyIdentifier,
}) => {
	if (!(audio instanceof Uint8Array) || audio.byteLength === 0) {
		throw new Error("Audio is required.");
	}

	if (audio.byteLength > MAX_DICTATION_AUDIO_BYTES) {
		throw new Error("Audio is too large.");
	}
	if (typeof safetyIdentifier !== "string" || safetyIdentifier.length === 0) {
		throw new Error("A safety identifier is required.");
	}

	const openaiOptions = buildOpenAIOptions({ language, prompt });
	const result = await transcribe({
		model: openai.transcription(DICTATION_TRANSCRIPTION_MODEL),
		audio,
		headers: {
			"OpenAI-Safety-Identifier": safetyIdentifier,
		},
		providerOptions:
			Object.keys(openaiOptions).length > 0
				? {
						openai: openaiOptions,
					}
				: undefined,
	});

	return {
		durationInSeconds: result.durationInSeconds,
		language: result.language,
		text: result.text.trim(),
	};
};
