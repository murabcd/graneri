import {
	getDesktopMeetingDetectionState,
	isDesktopRuntime,
	onDesktopMeetingDetectionState,
} from "@workspace/platform/desktop";
import * as React from "react";
import { toast } from "sonner";
import { logError } from "@/lib/logger";
import { requestMeetingEndClassification } from "@/lib/meeting-end-classification";
import type { TranscriptUtterance } from "@/lib/transcript";
import {
	decideMeetingEnd,
	MEETING_APP_EXIT_DEBOUNCE_MS,
	TRANSCRIPT_IDLE_STOP_MS,
	TranscriptionAutoStopController,
} from "@/lib/transcription-auto-stop";
import type { Id } from "../../../../convex/_generated/dataModel";

type StopCaptureAfterRequest = (args: {
	activeSessionId: Id<"transcriptSessions"> | null;
	hasPendingStart: boolean;
	reason?: string;
}) => Promise<void>;

type AutoStopContext = {
	activeSessionId: Id<"transcriptSessions"> | null;
	calendarEventEndAt: string | null;
	captureKey: string;
	captureStartedAt: number | null;
	hasPendingStart: boolean;
	isSpeechListening: boolean;
	utterances: TranscriptUtterance[];
};

const autoStopToastDurationMs = 30_000;

export const useTranscriptionAutoStop = ({
	activeSessionId,
	calendarEventEndAt,
	captureKey,
	captureStartedAt,
	hasPendingStart,
	isSpeechListening,
	stopCaptureAfterRequest,
	transcriptActivityKey,
	utterances,
}: AutoStopContext & {
	stopCaptureAfterRequest: StopCaptureAfterRequest;
	transcriptActivityKey: string;
}) => {
	const [controller] = React.useState(
		() => new TranscriptionAutoStopController(),
	);
	const latestContextRef = React.useRef<AutoStopContext>({
		activeSessionId,
		calendarEventEndAt,
		captureKey,
		captureStartedAt,
		hasPendingStart,
		isSpeechListening,
		utterances,
	});
	const latestMeetingAppCountRef = React.useRef(0);
	const latestTranscriptActivityKeyRef = React.useRef(transcriptActivityKey);
	const meetingExitTimeoutRef = React.useRef<number | null>(null);
	const autoStopToastIdRef = React.useRef<string | number | null>(null);

	React.useLayoutEffect(() => {
		latestContextRef.current = {
			activeSessionId,
			calendarEventEndAt,
			captureKey,
			captureStartedAt,
			hasPendingStart,
			isSpeechListening,
			utterances,
		};
		latestTranscriptActivityKeyRef.current = transcriptActivityKey;
	}, [
		activeSessionId,
		calendarEventEndAt,
		captureKey,
		captureStartedAt,
		hasPendingStart,
		isSpeechListening,
		transcriptActivityKey,
		utterances,
	]);

	const clearMeetingExitTimeout = React.useCallback(() => {
		if (meetingExitTimeoutRef.current === null) {
			return;
		}

		window.clearTimeout(meetingExitTimeoutRef.current);
		meetingExitTimeoutRef.current = null;
	}, []);

	const requestAutomaticStop = React.useCallback(
		async ({
			captureKeyAtDecision,
			reason,
			toastMessage,
		}: {
			captureKeyAtDecision: string;
			reason: string;
			toastMessage: string;
		}) => {
			const context = latestContextRef.current;
			if (
				context.captureKey !== captureKeyAtDecision ||
				!context.isSpeechListening
			) {
				return;
			}
			const stopRequestToken = controller.markRequested(captureKeyAtDecision);
			if (!stopRequestToken) {
				return;
			}

			try {
				await stopCaptureAfterRequest({
					activeSessionId: context.activeSessionId,
					hasPendingStart: context.hasPendingStart,
					reason,
				});
			} catch (error) {
				controller.restoreFailedRequest(captureKeyAtDecision, stopRequestToken);
				logError({
					event: "client.error",
					error,
					message: "Failed to stop transcription automatically",
				});
				return;
			}

			if (latestContextRef.current.captureKey !== captureKeyAtDecision) {
				return;
			}

			const toastId = `transcription-auto-stop:${captureKeyAtDecision}`;
			autoStopToastIdRef.current = toastId;
			toast.info(toastMessage, {
				duration: autoStopToastDurationMs,
				id: toastId,
			});
		},
		[controller, stopCaptureAfterRequest],
	);

	const evaluateMeetingExit = React.useCallback(
		async (captureKeyAtExit: string) => {
			meetingExitTimeoutRef.current = null;
			if (!controller.claimMeetingExit(captureKeyAtExit)) {
				return;
			}

			const context = latestContextRef.current;
			if (
				context.captureKey !== captureKeyAtExit ||
				!context.isSpeechListening
			) {
				return;
			}

			const decision = decideMeetingEnd({
				calendarEventEndAt: context.calendarEventEndAt,
				captureStartedAt: context.captureStartedAt,
				now: Date.now(),
				utterances: context.utterances,
			});
			if (decision.kind === "continue") {
				return;
			}

			if (decision.kind === "stop") {
				await requestAutomaticStop({
					captureKeyAtDecision: captureKeyAtExit,
					reason: "note-transcript-calendar-end-auto-stop",
					toastMessage: "Recording stopped when the meeting ended.",
				});
				return;
			}

			try {
				const classification = await requestMeetingEndClassification({
					transcript: decision.transcript,
				});
				if (
					!classification.ended ||
					!controller.canStopAfterClassification(captureKeyAtExit)
				) {
					return;
				}

				await requestAutomaticStop({
					captureKeyAtDecision: captureKeyAtExit,
					reason: "note-transcript-meeting-ended-auto-stop",
					toastMessage: "Recording stopped when the meeting ended.",
				});
			} catch (error) {
				logError({
					event: "client.error",
					error,
					message: "Failed to classify whether the meeting ended",
				});
			}
		},
		[controller, requestAutomaticStop],
	);

	const observeMeetingApps = React.useCallback(() => {
		const context = latestContextRef.current;
		if (!context.isSpeechListening) {
			return;
		}

		const transition = controller.observeMeetingApps({
			activeMeetingAppCount: latestMeetingAppCountRef.current,
			captureKey: context.captureKey,
		});
		if (transition === "cancel") {
			clearMeetingExitTimeout();
			return;
		}

		if (transition === "schedule") {
			clearMeetingExitTimeout();
			meetingExitTimeoutRef.current = window.setTimeout(() => {
				void evaluateMeetingExit(context.captureKey);
			}, MEETING_APP_EXIT_DEBOUNCE_MS);
		}
	}, [clearMeetingExitTimeout, controller, evaluateMeetingExit]);

	React.useEffect(() => {
		if (!isSpeechListening) {
			controller.endCapture(captureKey);
			clearMeetingExitTimeout();
			return;
		}

		clearMeetingExitTimeout();
		controller.beginCapture(captureKey);
		if (autoStopToastIdRef.current !== null) {
			toast.dismiss(autoStopToastIdRef.current);
			autoStopToastIdRef.current = null;
		}
		observeMeetingApps();
	}, [
		captureKey,
		clearMeetingExitTimeout,
		controller,
		isSpeechListening,
		observeMeetingApps,
	]);

	React.useEffect(() => {
		if (!isDesktopRuntime()) {
			return;
		}

		let hasReceivedPushState = false;
		const applyState = (
			state: NonNullable<
				Awaited<ReturnType<typeof getDesktopMeetingDetectionState>>
			>,
		) => {
			latestMeetingAppCountRef.current = state.activeMeetingApps.length;
			observeMeetingApps();
		};
		const unsubscribe = onDesktopMeetingDetectionState((state) => {
			hasReceivedPushState = true;
			applyState(state);
		});
		void getDesktopMeetingDetectionState()
			.then((state) => {
				if (state && !hasReceivedPushState) {
					applyState(state);
				}
			})
			.catch((error) => {
				logError({
					event: "client.error",
					error,
					message: "Failed to read desktop meeting detection state",
				});
			});

		return unsubscribe;
	}, [observeMeetingApps]);

	React.useEffect(() => {
		if (!isSpeechListening) {
			return;
		}

		const captureKeyAtStart = captureKey;
		const transcriptActivityKeyAtStart = transcriptActivityKey;
		const timeoutId = window.setTimeout(() => {
			if (
				latestTranscriptActivityKeyRef.current !==
					transcriptActivityKeyAtStart ||
				controller.hasRequestedStop(captureKeyAtStart)
			) {
				return;
			}

			void requestAutomaticStop({
				captureKeyAtDecision: captureKeyAtStart,
				reason: "note-transcript-idle-auto-stop",
				toastMessage:
					"Recording stopped after 15 minutes without transcript activity.",
			});
		}, TRANSCRIPT_IDLE_STOP_MS);

		return () => window.clearTimeout(timeoutId);
	}, [
		captureKey,
		controller,
		isSpeechListening,
		requestAutomaticStop,
		transcriptActivityKey,
	]);

	React.useEffect(
		() => () => {
			clearMeetingExitTimeout();
			if (autoStopToastIdRef.current !== null) {
				toast.dismiss(autoStopToastIdRef.current);
			}
		},
		[clearMeetingExitTimeout],
	);
};
