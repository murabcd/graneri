import { describe, expect, it } from "vitest";
import type { TranscriptUtterance } from "../src/lib/transcript";
import {
	decideMeetingEnd,
	MEETING_AUTO_STOP_MIN_SYSTEM_TRANSCRIPT_MS,
	TranscriptionAutoStopController,
} from "../src/lib/transcription-auto-stop";

const createUtterance = (
	text: string,
	startedAt: number,
	speaker: TranscriptUtterance["speaker"] = "them",
): TranscriptUtterance => ({
	endedAt: startedAt + 1_000,
	id: `${speaker}:${startedAt}`,
	speaker,
	startedAt,
	text,
});

describe("meeting transcription auto-stop", () => {
	it("ignores meeting apps observed before a capture begins", () => {
		const controller = new TranscriptionAutoStopController();

		expect(
			controller.observeMeetingApps({
				activeMeetingAppCount: 1,
				captureKey: "note-1",
			}),
		).toBeNull();
		controller.beginCapture("note-1");
		expect(
			controller.observeMeetingApps({
				activeMeetingAppCount: 0,
				captureKey: "note-1",
			}),
		).toBeNull();
	});

	it("schedules one candidate when every observed meeting app exits", () => {
		const controller = new TranscriptionAutoStopController();
		controller.beginCapture("note-1");

		expect(
			controller.observeMeetingApps({
				activeMeetingAppCount: 2,
				captureKey: "note-1",
			}),
		).toBe("cancel");
		expect(
			controller.observeMeetingApps({
				activeMeetingAppCount: 1,
				captureKey: "note-1",
			}),
		).toBe("cancel");
		expect(
			controller.observeMeetingApps({
				activeMeetingAppCount: 0,
				captureKey: "note-1",
			}),
		).toBe("schedule");
		expect(
			controller.observeMeetingApps({
				activeMeetingAppCount: 0,
				captureKey: "note-1",
			}),
		).toBeNull();
	});

	it("cancels an exit candidate when a meeting app returns", () => {
		const controller = new TranscriptionAutoStopController();
		controller.beginCapture("note-1");
		controller.observeMeetingApps({
			activeMeetingAppCount: 1,
			captureKey: "note-1",
		});
		controller.observeMeetingApps({
			activeMeetingAppCount: 0,
			captureKey: "note-1",
		});

		expect(
			controller.observeMeetingApps({
				activeMeetingAppCount: 1,
				captureKey: "note-1",
			}),
		).toBe("cancel");
		expect(controller.claimMeetingExit("note-1")).toBe(false);
	});

	it("keeps a requested stop terminal until it succeeds or is restored", () => {
		const controller = new TranscriptionAutoStopController();
		controller.beginCapture("note-1");
		controller.observeMeetingApps({
			activeMeetingAppCount: 1,
			captureKey: "note-1",
		});
		const stopRequestToken = controller.markRequested("note-1");

		expect(stopRequestToken).not.toBeNull();
		expect(
			controller.observeMeetingApps({
				activeMeetingAppCount: 0,
				captureKey: "note-1",
			}),
		).toBeNull();
		expect(controller.hasRequestedStop("note-1")).toBe(true);

		if (stopRequestToken) {
			controller.restoreFailedRequest("note-1", stopRequestToken);
		}
		expect(controller.hasRequestedStop("note-1")).toBe(false);
	});

	it("requires three minutes from the first system-audio utterance", () => {
		const now = 1_000_000;
		const decision = decideMeetingEnd({
			calendarEventEndAt: null,
			captureStartedAt:
				now - MEETING_AUTO_STOP_MIN_SYSTEM_TRANSCRIPT_MS - 1_000,
			now,
			utterances: [
				createUtterance(
					"Thanks everyone, goodbye.",
					now - MEETING_AUTO_STOP_MIN_SYSTEM_TRANSCRIPT_MS + 1,
				),
			],
		});

		expect(decision).toEqual({
			kind: "continue",
			reason: "system-transcript-too-short",
		});
	});

	it("stops directly within five minutes of the linked calendar end", () => {
		const now = 1_000_000;
		const decision = decideMeetingEnd({
			calendarEventEndAt: new Date(now + 4 * 60_000).toISOString(),
			captureStartedAt:
				now - MEETING_AUTO_STOP_MIN_SYSTEM_TRANSCRIPT_MS - 1_000,
			now,
			utterances: [
				createUtterance(
					"We are wrapping up.",
					now - MEETING_AUTO_STOP_MIN_SYSTEM_TRANSCRIPT_MS,
				),
			],
		});

		expect(decision).toEqual({ kind: "stop", reason: "calendar-end" });
	});

	it("classifies only the last one hundred transcript words", () => {
		const now = 1_000_000;
		const words = Array.from({ length: 120 }, (_, index) => `word${index + 1}`);
		const decision = decideMeetingEnd({
			calendarEventEndAt: null,
			captureStartedAt:
				now - MEETING_AUTO_STOP_MIN_SYSTEM_TRANSCRIPT_MS - 1_000,
			now,
			utterances: [
				createUtterance(
					words.join(" "),
					now - MEETING_AUTO_STOP_MIN_SYSTEM_TRANSCRIPT_MS,
				),
			],
		});

		expect(decision.kind).toBe("classify");
		if (decision.kind !== "classify") {
			return;
		}
		expect(decision.transcript.split(/\s+/u)).toHaveLength(100);
		expect(decision.transcript).not.toContain("word1 ");
		expect(decision.transcript).toContain("word120");
	});

	it("ignores system transcript from before the current capture", () => {
		const now = 1_000_000;
		const captureStartedAt = now - 10_000;
		const decision = decideMeetingEnd({
			calendarEventEndAt: null,
			captureStartedAt,
			now,
			utterances: [
				createUtterance(
					"Goodbye from the previous recording.",
					captureStartedAt - MEETING_AUTO_STOP_MIN_SYSTEM_TRANSCRIPT_MS,
				),
			],
		});

		expect(decision).toEqual({
			kind: "continue",
			reason: "missing-system-transcript",
		});
	});
});
