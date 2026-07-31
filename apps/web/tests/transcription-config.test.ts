import {
	createRealtimeTranscriptionSession,
	DICTATION_TRANSCRIPTION_MODEL,
	REALTIME_TRANSCRIPTION_DELAY,
	REALTIME_TRANSCRIPTION_MODEL,
} from "@workspace/ai/transcription";
import { describe, expect, it } from "vitest";

describe("transcription config", () => {
	it("keeps dictation and realtime transcription models separate", () => {
		expect(DICTATION_TRANSCRIPTION_MODEL).toBe("gpt-transcribe");
		expect(REALTIME_TRANSCRIPTION_MODEL).toBe("gpt-live-transcribe");
		expect(REALTIME_TRANSCRIPTION_DELAY).toBe("high");
	});

	it("uses GPT Live Transcribe session fields for browser transcription", () => {
		const session = createRealtimeTranscriptionSession({
			language: "en",
			transport: "webrtc",
		});

		expect(session).toEqual({
			type: "transcription",
			audio: {
				input: {
					format: {
						rate: 24_000,
						type: "audio/pcm",
					},
					noise_reduction: null,
					transcription: {
						delay: "high",
						languages: ["en"],
						model: "gpt-live-transcribe",
					},
					turn_detection: { type: "server_vad" },
				},
			},
		});
	});

	it("disables turn detection for manually committed desktop sessions", () => {
		const session = createRealtimeTranscriptionSession({
			language: "en",
			transport: "websocket",
		});

		expect(session.audio.input.turn_detection).toBeNull();
	});
});
