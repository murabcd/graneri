export const REALTIME_TRANSCRIPTION_MODEL = "gpt-live-transcribe";
export const DICTATION_TRANSCRIPTION_MODEL = "gpt-transcribe";
export const AUDIO_TRANSCRIPTION_SAMPLE_RATE = 24_000;
export const REALTIME_TRANSCRIPTION_DELAY = "high";

const transcriptPlaceholderPatterns = new Set([
	"audio unclear",
	"background noise",
	"inaudible",
	"music",
	"noise",
	"silence",
	"unintelligible",
]);

const TRANSCRIPT_EMBEDDED_SPEAKER_PATTERN = /Speaker ([^:]+):/;

const DEFAULT_TRANSCRIPT_SPEAKER_LABELS = {
	them: "Them",
	you: "You",
};

export const normalizeTranscriptText = (value) =>
	typeof value === "string"
		? value
				.toLowerCase()
				.replace(/[^\p{L}\p{N}\s]+/gu, " ")
				.replace(/\s+/g, " ")
				.trim()
		: "";

export const getTranscriptWordCount = (value) =>
	normalizeTranscriptText(value).split(" ").filter(Boolean).length;

const getTranscriptUtteranceId = (utterance) => String(utterance.id);

const getTranscriptUtteranceText = (utterance) =>
	typeof utterance.text === "string" ? utterance.text.trim() : "";

const getTranscriptEmbeddedSpeaker = (text) =>
	String(text ?? "").match(TRANSCRIPT_EMBEDDED_SPEAKER_PATTERN)?.[1] ?? null;

const shouldEndTranscriptSection = (section) =>
	String(section?.text ?? "")
		.trim()
		.endsWith(".");

export const compareTranscriptUtteranceOrder = (left, right) => {
	const leftStartedAt = Number(left.startedAt);
	const rightStartedAt = Number(right.startedAt);

	if (leftStartedAt !== rightStartedAt) {
		return leftStartedAt - rightStartedAt;
	}

	const leftEndedAt = Number(left.endedAt);
	const rightEndedAt = Number(right.endedAt);

	if (leftEndedAt !== rightEndedAt) {
		return leftEndedAt - rightEndedAt;
	}

	return getTranscriptUtteranceId(left).localeCompare(
		getTranscriptUtteranceId(right),
	);
};

const joinTranscriptSectionText = (currentText, nextText) => {
	const normalizedCurrentText = String(currentText ?? "").trim();
	const normalizedNextText = String(nextText ?? "").trim();

	if (!normalizedCurrentText) {
		return normalizedNextText;
	}

	if (!normalizedNextText) {
		return normalizedCurrentText;
	}

	return `${normalizedCurrentText} ${normalizedNextText}`;
};

export const shouldAppendTranscriptUtteranceToSection = ({
	section,
	utterance,
}) => {
	if (section.speaker !== utterance.speaker) {
		return false;
	}

	const sectionEmbeddedSpeaker = getTranscriptEmbeddedSpeaker(section.text);
	const utteranceEmbeddedSpeaker = getTranscriptEmbeddedSpeaker(utterance.text);
	if (
		sectionEmbeddedSpeaker &&
		utteranceEmbeddedSpeaker &&
		sectionEmbeddedSpeaker !== utteranceEmbeddedSpeaker
	) {
		return false;
	}

	return !shouldEndTranscriptSection(section);
};

const getTranscriptSpeakerLabel = (speaker, speakerLabels) => {
	const normalizedSpeaker = String(speaker ?? "").trim();
	const configuredLabel = speakerLabels?.[normalizedSpeaker];

	if (typeof configuredLabel === "string" && configuredLabel.trim()) {
		return configuredLabel.trim();
	}

	if (!normalizedSpeaker) {
		return "Speaker";
	}

	return `${normalizedSpeaker.charAt(0).toUpperCase()}${normalizedSpeaker.slice(1)}`;
};

export const createTranscriptTextSections = (utterances = []) => {
	const sections = [];

	for (const rawUtterance of [...utterances].sort(
		compareTranscriptUtteranceOrder,
	)) {
		const text = getTranscriptUtteranceText(rawUtterance);

		if (!text) {
			continue;
		}

		const utteranceId = getTranscriptUtteranceId(rawUtterance);
		const utterance = {
			endedAt: Number(rawUtterance.endedAt),
			id: utteranceId,
			speaker: String(rawUtterance.speaker),
			startedAt: Number(rawUtterance.startedAt),
			text,
		};
		const previousSection = sections.at(-1);

		if (
			previousSection &&
			shouldAppendTranscriptUtteranceToSection({
				section: previousSection,
				utterance,
			})
		) {
			previousSection.endedAt = Math.max(
				previousSection.endedAt,
				utterance.endedAt,
			);
			previousSection.id = previousSection.utteranceIds
				.concat(utterance.id)
				.join("|");
			previousSection.text = joinTranscriptSectionText(
				previousSection.text,
				utterance.text,
			);
			previousSection.utteranceIds.push(utterance.id);
			continue;
		}

		sections.push({
			endedAt: utterance.endedAt,
			id: utterance.id,
			speaker: utterance.speaker,
			startedAt: utterance.startedAt,
			text: utterance.text,
			utteranceIds: [utterance.id],
		});
	}

	return sections;
};

export const createTranscriptBlocksText = (
	sections = [],
	{ speakerLabels = DEFAULT_TRANSCRIPT_SPEAKER_LABELS } = {},
) =>
	sections
		.flatMap((section) => {
			const text = typeof section?.text === "string" ? section.text.trim() : "";

			if (!text) {
				return [];
			}

			return [
				`${getTranscriptSpeakerLabel(section.speaker, speakerLabels)}: ${text}`,
			];
		})
		.join("\n\n")
		.trim();

export const createTranscriptBlocksTextFromUtterances = (
	utterances = [],
	options = {},
) =>
	createTranscriptBlocksText(createTranscriptTextSections(utterances), options);

export const isTranscriptPlaceholderText = (value) => {
	const normalizedValue = normalizeTranscriptText(value);

	if (!normalizedValue) {
		return false;
	}

	return (
		transcriptPlaceholderPatterns.has(normalizedValue) &&
		getTranscriptWordCount(normalizedValue) <= 2
	);
};

export const normalizeTranscriptionLanguage = (value) =>
	value?.split("-")[0]?.trim().toLowerCase() || null;

export const createRealtimeTranscriptionSession = ({
	language = null,
	transport,
}) => ({
	type: "transcription",
	audio: {
		input: {
			format: {
				type: "audio/pcm",
				rate: AUDIO_TRANSCRIPTION_SAMPLE_RATE,
			},
			noise_reduction: null,
			transcription: {
				model: REALTIME_TRANSCRIPTION_MODEL,
				delay: REALTIME_TRANSCRIPTION_DELAY,
				...(language ? { languages: [language] } : {}),
			},
			turn_detection: transport === "websocket" ? null : { type: "server_vad" },
		},
	},
});

export const shouldKeepInterruptedTranscriptTurn = (text) => {
	const normalizedText = normalizeTranscriptText(text);

	if (!normalizedText || isTranscriptPlaceholderText(normalizedText)) {
		return false;
	}

	return true;
};
