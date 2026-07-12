import { isTranscriptPlaceholderText } from "@workspace/ai/transcription";

const PROMPT_LEAK_PATTERNS = [
	"transcribe speech verbatim",
	"transcribe only the spoken",
	"transcribe the audio clearly",
	"preserve names, product terms",
	"preserve names, jargon",
	"domain-specific vocabulary",
	"quoted wording",
	"continue from the previous transcript segment",
	"follow instructions",
	"return an empty string",
	"output nothing",
	"context:",
] as const;

export const containsTranscriptPromptLeakage = (value: string) => {
	const normalizedValue = value.trim().toLowerCase();

	if (!normalizedValue) {
		return false;
	}

	return PROMPT_LEAK_PATTERNS.some((pattern) =>
		normalizedValue.includes(pattern),
	);
};

export const isSuspiciousCommittedTranscriptText = ({
	text,
}: {
	text: string;
}) => {
	const trimmedText = text.trim();

	if (!trimmedText) {
		return false;
	}

	if (containsTranscriptPromptLeakage(trimmedText)) {
		return true;
	}

	if (isTranscriptPlaceholderText(trimmedText)) {
		return true;
	}

	return false;
};
