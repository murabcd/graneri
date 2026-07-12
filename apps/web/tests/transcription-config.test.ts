import {
	createRealtimeTranscriptionSession,
	createRealtimeTranscriptionSessionOptions,
	DESKTOP_REALTIME_PROFILE,
	DICTATION_TRANSCRIPTION_MODEL,
	isLowConfidenceTranscriptLogprobs,
	REALTIME_TRANSCRIPTION_DELAY,
	REALTIME_TRANSCRIPTION_MODEL,
} from "@workspace/ai/transcription";
import { describe, expect, it } from "vitest";

describe("transcription config", () => {
	it("keeps dictation and realtime transcription models separate", () => {
		expect(DICTATION_TRANSCRIPTION_MODEL).toBe("gpt-4o-mini-transcribe");
		expect(REALTIME_TRANSCRIPTION_MODEL).toBe("gpt-realtime-whisper");
		expect(REALTIME_TRANSCRIPTION_DELAY).toBe("high");
	});

	it("serializes nullable noise reduction in realtime transcription sessions", () => {
		expect(
			createRealtimeTranscriptionSession({
				language: "en",
				noiseReductionType: null,
			}).audio.input.noise_reduction,
		).toBeNull();
	});

	it("uses realtime-whisper session fields for live transcription", () => {
		const session = createRealtimeTranscriptionSession(
			createRealtimeTranscriptionSessionOptions({
				language: "en",
			}),
		);

		expect(session.audio.input).not.toHaveProperty("turn_detection");
		expect(session.audio.input.transcription).toEqual({
			delay: "high",
			language: "en",
			model: "gpt-realtime-whisper",
		});
	});

	it("uses the default desktop realtime profile across realtime sessions", () => {
		const session = createRealtimeTranscriptionSession(
			createRealtimeTranscriptionSessionOptions({ language: "en" }),
		);

		expect(session.audio.input).not.toHaveProperty("turn_detection");
		expect(DESKTOP_REALTIME_PROFILE).toBe("default");
	});

	it("uses stricter low-confidence thresholds for system audio", () => {
		expect(
			isLowConfidenceTranscriptLogprobs({
				logprobs: [
					{ logprob: -1.8, token: "hello" },
					{ logprob: -2.4, token: "world" },
					{ logprob: -3.6, token: "today" },
				],
				source: "systemAudio",
				text: "hello world today",
			}),
		).toBe(true);

		expect(
			isLowConfidenceTranscriptLogprobs({
				logprobs: [
					{ logprob: -0.08, token: "hello" },
					{ logprob: -0.05, token: "world" },
					{ logprob: -0.09, token: "today" },
				],
				source: "systemAudio",
				text: "hello world today",
			}),
		).toBe(false);
	});
});
