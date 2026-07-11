export type DictationTranscriptionResult = {
	durationInSeconds?: number;
	language?: string;
	text: string;
};

export function transcribeDictationAudio(options: {
	audio: Uint8Array;
	language?: string | null;
	prompt?: string | null;
	safetyIdentifier: string;
}): Promise<DictationTranscriptionResult>;
