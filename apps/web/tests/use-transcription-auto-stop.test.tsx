import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useTranscriptionAutoStop } from "../src/hooks/use-transcription-auto-stop";
import type { TranscriptUtterance } from "../src/lib/transcript";
import {
	MEETING_APP_EXIT_DEBOUNCE_MS,
	MEETING_AUTO_STOP_MIN_SYSTEM_TRANSCRIPT_MS,
	TRANSCRIPT_IDLE_STOP_MS,
} from "../src/lib/transcription-auto-stop";

const platformMocks = vi.hoisted(() => ({
	getState: vi.fn(),
	listener: null as
		| ((state: { activeMeetingApps: unknown[]; calendarEvent: null }) => void)
		| null,
}));
const classificationMocks = vi.hoisted(() => ({
	request: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({
	dismiss: vi.fn(),
	info: vi.fn(),
}));

vi.mock("@workspace/platform/desktop", () => ({
	getDesktopMeetingDetectionState: platformMocks.getState,
	isDesktopRuntime: () => true,
	onDesktopMeetingDetectionState: (listener: typeof platformMocks.listener) => {
		platformMocks.listener = listener;
		return () => {
			platformMocks.listener = null;
		};
	},
}));

vi.mock("../src/lib/meeting-end-classification", () => ({
	requestMeetingEndClassification: classificationMocks.request,
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

const createMeetingState = (activeMeetingAppCount: number) => ({
	activeMeetingApps: Array.from({ length: activeMeetingAppCount }, () => ({})),
	calendarEvent: null,
});

const createMatureTranscript = (): TranscriptUtterance[] => [
	{
		endedAt: Date.now() - MEETING_AUTO_STOP_MIN_SYSTEM_TRANSCRIPT_MS + 1_000,
		id: "them:1",
		speaker: "them",
		startedAt: Date.now() - MEETING_AUTO_STOP_MIN_SYSTEM_TRANSCRIPT_MS,
		text: "Thanks everyone, goodbye.",
	},
];

const renderAutoStop = ({
	stopCaptureAfterRequest = vi.fn().mockResolvedValue(undefined),
	transcriptActivityKey = "activity-1",
	utterances = createMatureTranscript(),
}: {
	stopCaptureAfterRequest?: ReturnType<typeof vi.fn>;
	transcriptActivityKey?: string;
	utterances?: TranscriptUtterance[];
} = {}) => {
	const hook = renderHook(
		({ activityKey }) =>
			useTranscriptionAutoStop({
				activeSessionId: "session-1" as Id<"transcriptSessions">,
				calendarEventEndAt: null,
				captureKey: "note-1",
				captureStartedAt:
					Date.now() - MEETING_AUTO_STOP_MIN_SYSTEM_TRANSCRIPT_MS - 1_000,
				hasPendingStart: false,
				isSpeechListening: true,
				stopCaptureAfterRequest,
				transcriptActivityKey: activityKey,
				utterances,
			}),
		{ initialProps: { activityKey: transcriptActivityKey } },
	);
	return { ...hook, stopCaptureAfterRequest };
};

describe("useTranscriptionAutoStop", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		platformMocks.getState.mockResolvedValue(null);
		platformMocks.listener = null;
		classificationMocks.request.mockReset();
		toastMocks.dismiss.mockReset();
		toastMocks.info.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("stops only after the two-second app-exit debounce and an affirmative classification", async () => {
		classificationMocks.request.mockResolvedValue({ ended: true });
		const stopCaptureAfterRequest = vi.fn().mockResolvedValue(undefined);
		renderAutoStop({ stopCaptureAfterRequest });

		act(() => platformMocks.listener?.(createMeetingState(1)));
		act(() => platformMocks.listener?.(createMeetingState(0)));
		await act(async () => {
			vi.advanceTimersByTime(MEETING_APP_EXIT_DEBOUNCE_MS - 1);
		});
		expect(classificationMocks.request).not.toHaveBeenCalled();

		await act(async () => {
			vi.advanceTimersByTime(1);
			await Promise.resolve();
		});

		expect(classificationMocks.request).toHaveBeenCalledOnce();
		expect(stopCaptureAfterRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				reason: "note-transcript-meeting-ended-auto-stop",
			}),
		);
		expect(toastMocks.info).toHaveBeenCalledWith(
			"Recording stopped when the meeting ended.",
			{
				duration: 30_000,
				id: "transcription-auto-stop:note-1",
			},
		);
	});

	it("keeps recording after a negative classification", async () => {
		classificationMocks.request.mockResolvedValue({ ended: false });
		const stopCaptureAfterRequest = vi.fn().mockResolvedValue(undefined);
		renderAutoStop({ stopCaptureAfterRequest });

		act(() => platformMocks.listener?.(createMeetingState(1)));
		act(() => platformMocks.listener?.(createMeetingState(0)));
		await act(async () => {
			vi.advanceTimersByTime(MEETING_APP_EXIT_DEBOUNCE_MS);
			await Promise.resolve();
		});

		expect(classificationMocks.request).toHaveBeenCalledOnce();
		expect(stopCaptureAfterRequest).not.toHaveBeenCalled();
	});

	it("keeps recording when classification fails", async () => {
		classificationMocks.request.mockRejectedValue(new Error("network down"));
		const stopCaptureAfterRequest = vi.fn().mockResolvedValue(undefined);
		renderAutoStop({ stopCaptureAfterRequest });

		act(() => platformMocks.listener?.(createMeetingState(1)));
		act(() => platformMocks.listener?.(createMeetingState(0)));
		await act(async () => {
			vi.advanceTimersByTime(MEETING_APP_EXIT_DEBOUNCE_MS);
			await Promise.resolve();
		});

		expect(classificationMocks.request).toHaveBeenCalledOnce();
		expect(stopCaptureAfterRequest).not.toHaveBeenCalled();
	});

	it("cancels the pending exit when a meeting app returns", async () => {
		const stopCaptureAfterRequest = vi.fn().mockResolvedValue(undefined);
		renderAutoStop({ stopCaptureAfterRequest });

		act(() => platformMocks.listener?.(createMeetingState(1)));
		act(() => platformMocks.listener?.(createMeetingState(0)));
		act(() => platformMocks.listener?.(createMeetingState(1)));
		await act(async () => {
			vi.advanceTimersByTime(MEETING_APP_EXIT_DEBOUNCE_MS);
		});

		expect(classificationMocks.request).not.toHaveBeenCalled();
		expect(stopCaptureAfterRequest).not.toHaveBeenCalled();
	});

	it("ignores an affirmative classification when a meeting app returns", async () => {
		let resolveClassification:
			| ((value: { ended: boolean }) => void)
			| undefined;
		classificationMocks.request.mockReturnValue(
			new Promise((resolve) => {
				resolveClassification = resolve;
			}),
		);
		const stopCaptureAfterRequest = vi.fn().mockResolvedValue(undefined);
		renderAutoStop({ stopCaptureAfterRequest });

		act(() => platformMocks.listener?.(createMeetingState(1)));
		act(() => platformMocks.listener?.(createMeetingState(0)));
		await act(async () => {
			vi.advanceTimersByTime(MEETING_APP_EXIT_DEBOUNCE_MS);
			await Promise.resolve();
		});
		expect(classificationMocks.request).toHaveBeenCalledOnce();

		act(() => platformMocks.listener?.(createMeetingState(1)));
		await act(async () => {
			resolveClassification?.({ ended: true });
			await Promise.resolve();
		});

		expect(stopCaptureAfterRequest).not.toHaveBeenCalled();
	});

	it("resets the inactivity deadline when transcript activity changes", async () => {
		const stopCaptureAfterRequest = vi.fn().mockResolvedValue(undefined);
		const { rerender } = renderAutoStop({ stopCaptureAfterRequest });

		await act(async () => {
			vi.advanceTimersByTime(TRANSCRIPT_IDLE_STOP_MS - 1);
		});
		rerender({ activityKey: "activity-2" });
		await act(async () => {
			vi.advanceTimersByTime(TRANSCRIPT_IDLE_STOP_MS - 1);
		});
		expect(stopCaptureAfterRequest).not.toHaveBeenCalled();

		await act(async () => {
			vi.advanceTimersByTime(1);
			await Promise.resolve();
		});
		expect(stopCaptureAfterRequest).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "note-transcript-idle-auto-stop" }),
		);
	});
});
