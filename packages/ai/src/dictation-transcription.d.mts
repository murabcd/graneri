export type DictationTranscriptionResult = {
	durationInSeconds?: number;
	languages: string[];
	text: string;
};

export type DictationTranscriptionOptions = {
	audio: Uint8Array;
	safetyIdentifier: string;
};

export type DictationAudioTranscriber = (
	options: DictationTranscriptionOptions,
) => Promise<DictationTranscriptionResult>;

export function createDictationAudioTranscriber(dependencies: {
	apiKey: string | undefined;
	fetch: typeof globalThis.fetch;
}): DictationAudioTranscriber;

export const transcribeDictationAudio: DictationAudioTranscriber;
