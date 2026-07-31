export declare const REALTIME_TRANSCRIPTION_MODEL: "gpt-live-transcribe";
export declare const DICTATION_TRANSCRIPTION_MODEL: "gpt-transcribe";
export declare const AUDIO_TRANSCRIPTION_SAMPLE_RATE: 24000;
export declare const REALTIME_TRANSCRIPTION_DELAY: "high";

export declare function normalizeTranscriptionLanguage(
	value?: string | null,
): string | null;

export declare function normalizeTranscriptText(value?: string | null): string;

export declare function getTranscriptWordCount(value?: string | null): number;

export type TranscriptTextUtterance = {
	endedAt: number;
	id: string;
	speaker: string;
	startedAt: number;
	text: string;
};

export type TranscriptTextSection = {
	endedAt: number;
	id: string;
	speaker: string;
	startedAt: number;
	text: string;
	utteranceIds: string[];
};

export declare function compareTranscriptUtteranceOrder(
	left: TranscriptTextUtterance,
	right: TranscriptTextUtterance,
): number;

export declare function createTranscriptTextSections(
	utterances?: TranscriptTextUtterance[],
): TranscriptTextSection[];

export declare function shouldAppendTranscriptUtteranceToSection(args: {
	section: TranscriptTextSection;
	utterance: TranscriptTextUtterance;
}): boolean;

export declare function createTranscriptBlocksText(
	sections?: Array<{
		speaker?: string | null;
		text?: string | null;
	}>,
	options?: {
		speakerLabels?: Record<string, string>;
	},
): string;

export declare function createTranscriptBlocksTextFromUtterances(
	utterances?: TranscriptTextUtterance[],
	options?: {
		speakerLabels?: Record<string, string>;
	},
): string;

export declare function isTranscriptPlaceholderText(
	value?: string | null,
): boolean;

export declare function createRealtimeTranscriptionSession(options: {
	language?: string | null;
	transport: "webrtc" | "websocket";
}): {
	type: "transcription";
	audio: {
		input: {
			format: {
				type: "audio/pcm";
				rate: 24000;
			};
			noise_reduction: null;
			transcription: {
				delay: "high";
				model: typeof REALTIME_TRANSCRIPTION_MODEL;
				languages?: string[];
			};
			turn_detection: null | { type: "server_vad" };
		};
	};
};

export declare function shouldKeepInterruptedTranscriptTurn(
	text?: string | null,
): boolean;
