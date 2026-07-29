const AUTO_DETECT_TRANSCRIPTION_LANGUAGE = "auto";

export const PRIMARY_TRANSCRIPTION_LANGUAGE_OPTIONS = [
	{ value: AUTO_DETECT_TRANSCRIPTION_LANGUAGE, label: "Auto-detect" },
	{ value: "en", label: "English" },
] as const;

export const OTHER_TRANSCRIPTION_LANGUAGE_OPTIONS = [
	{ value: "zh", label: "Chinese" },
	{ value: "nl", label: "Dutch" },
	{ value: "fi", label: "Finnish" },
	{ value: "fr", label: "French" },
	{ value: "de", label: "German" },
	{ value: "hi", label: "Hindi" },
	{ value: "it", label: "Italian" },
	{ value: "ja", label: "Japanese" },
	{ value: "ko", label: "Korean" },
	{ value: "pl", label: "Polish" },
	{ value: "pt", label: "Portuguese" },
	{ value: "ru", label: "Russian" },
	{ value: "es", label: "Spanish" },
	{ value: "tr", label: "Turkish" },
	{ value: "uk", label: "Ukrainian" },
	{ value: "vi", label: "Vietnamese" },
] as const;

export const TRANSCRIPTION_LANGUAGE_OPTIONS = [
	...PRIMARY_TRANSCRIPTION_LANGUAGE_OPTIONS,
	...OTHER_TRANSCRIPTION_LANGUAGE_OPTIONS,
] as const;

const transcriptionLanguageCodes = new Set<string>(
	TRANSCRIPTION_LANGUAGE_OPTIONS.flatMap((option) =>
		option.value === AUTO_DETECT_TRANSCRIPTION_LANGUAGE ? [] : [option.value],
	),
);

export const parseTranscriptionLanguageInput = (value: unknown) => {
	if (value === undefined || value === null || value === "") {
		return null;
	}

	if (typeof value !== "string") {
		throw new Error(
			"Transcription language must be a supported language code.",
		);
	}

	const normalizedLanguage = value.trim().toLowerCase();
	if (!transcriptionLanguageCodes.has(normalizedLanguage)) {
		throw new Error(
			"Transcription language must be a supported language code.",
		);
	}

	return normalizedLanguage;
};

export const getTranscriptionLanguageSelectValue = (
	value: string | null | undefined,
) => value ?? AUTO_DETECT_TRANSCRIPTION_LANGUAGE;

export const parseTranscriptionLanguageSelectValue = (value: string) =>
	value === AUTO_DETECT_TRANSCRIPTION_LANGUAGE
		? null
		: parseTranscriptionLanguageInput(value);
