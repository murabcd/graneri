import { MEETING_END_TRANSCRIPT_MAX_WORDS } from "@workspace/ai/meeting-end-classification";
import type { TranscriptUtterance } from "@/lib/transcript";

export const MEETING_APP_EXIT_DEBOUNCE_MS = 2_000;
export const MEETING_AUTO_STOP_MIN_SYSTEM_TRANSCRIPT_MS = 3 * 60 * 1_000;
export const MEETING_AUTO_STOP_CALENDAR_END_WINDOW_MS = 5 * 60 * 1_000;
export const TRANSCRIPT_IDLE_STOP_MS = 15 * 60 * 1_000;

type MeetingExitTransition = "cancel" | "schedule" | null;
type MeetingAppPhase =
	| "unobserved"
	| "active"
	| "exit-pending"
	| "exit-evaluated"
	| "stop-requested";

type TranscriptionAutoStopState = {
	activeCaptureKey: string | null;
	meetingAppPhase: MeetingAppPhase;
};

type StopRequestToken = {
	meetingAppPhase: Exclude<MeetingAppPhase, "stop-requested">;
};

export type MeetingEndDecision =
	| {
			kind: "continue";
			reason:
				| "capture-not-started"
				| "missing-system-transcript"
				| "system-transcript-too-short";
	  }
	| { kind: "stop"; reason: "calendar-end" }
	| { kind: "classify"; transcript: string };

const createTranscriptionAutoStopState = (): TranscriptionAutoStopState => ({
	activeCaptureKey: null,
	meetingAppPhase: "unobserved",
});

const getTranscriptSpeakerLabel = (speaker: TranscriptUtterance["speaker"]) =>
	speaker === "you" ? "You:" : "Them:";

const selectLastTranscriptWords = (
	utterances: TranscriptUtterance[],
	wordLimit: number,
) => {
	let remainingWords = wordLimit;
	const selectedChunks: string[] = [];
	const orderedUtterances = utterances
		.slice()
		.sort((left, right) => left.startedAt - right.startedAt);

	for (let index = orderedUtterances.length - 1; index >= 0; index -= 1) {
		const utterance = orderedUtterances[index];
		if (!utterance) {
			continue;
		}

		const words =
			`${getTranscriptSpeakerLabel(utterance.speaker)} ${utterance.text}`
				.trim()
				.split(/\s+/u)
				.filter(Boolean);
		const selectedWords = words.slice(-remainingWords);
		selectedChunks.unshift(selectedWords.join(" "));
		remainingWords -= selectedWords.length;
		if (remainingWords === 0) {
			break;
		}
	}

	return selectedChunks.join(" ");
};

export const decideMeetingEnd = ({
	calendarEventEndAt,
	captureStartedAt,
	now,
	utterances,
}: {
	calendarEventEndAt: string | null;
	captureStartedAt: number | null;
	now: number;
	utterances: TranscriptUtterance[];
}): MeetingEndDecision => {
	if (captureStartedAt === null) {
		return { kind: "continue", reason: "capture-not-started" };
	}

	const currentCaptureUtterances = utterances.filter(
		(utterance) => utterance.startedAt >= captureStartedAt,
	);
	const firstSystemUtterance = currentCaptureUtterances.reduce<
		TranscriptUtterance | undefined
	>(
		(earliest, utterance) =>
			utterance.speaker === "them" &&
			(!earliest || utterance.startedAt < earliest.startedAt)
				? utterance
				: earliest,
		undefined,
	);
	if (!firstSystemUtterance) {
		return { kind: "continue", reason: "missing-system-transcript" };
	}

	if (
		now - firstSystemUtterance.startedAt <
		MEETING_AUTO_STOP_MIN_SYSTEM_TRANSCRIPT_MS
	) {
		return { kind: "continue", reason: "system-transcript-too-short" };
	}

	const calendarEnd = calendarEventEndAt
		? Date.parse(calendarEventEndAt)
		: Number.NaN;
	if (
		Number.isFinite(calendarEnd) &&
		Math.abs(now - calendarEnd) <= MEETING_AUTO_STOP_CALENDAR_END_WINDOW_MS
	) {
		return { kind: "stop", reason: "calendar-end" };
	}

	return {
		kind: "classify",
		transcript: selectLastTranscriptWords(
			currentCaptureUtterances,
			MEETING_END_TRANSCRIPT_MAX_WORDS,
		),
	};
};

export class TranscriptionAutoStopController {
	private state = createTranscriptionAutoStopState();

	beginCapture = (captureKey: string) => {
		this.state = {
			...createTranscriptionAutoStopState(),
			activeCaptureKey: captureKey,
		};
	};

	endCapture = (captureKey: string) => {
		if (this.state.activeCaptureKey === captureKey) {
			this.state = createTranscriptionAutoStopState();
		}
	};

	hasRequestedStop = (captureKey: string) =>
		this.state.activeCaptureKey === captureKey &&
		this.state.meetingAppPhase === "stop-requested";

	markRequested = (captureKey: string) => {
		if (
			this.state.activeCaptureKey !== captureKey ||
			this.state.meetingAppPhase === "stop-requested"
		) {
			return null;
		}

		const token: StopRequestToken = {
			meetingAppPhase: this.state.meetingAppPhase,
		};
		this.state.meetingAppPhase = "stop-requested";
		return token;
	};

	restoreFailedRequest = (captureKey: string, token: StopRequestToken) => {
		if (
			this.state.activeCaptureKey === captureKey &&
			this.state.meetingAppPhase === "stop-requested"
		) {
			this.state.meetingAppPhase = token.meetingAppPhase;
		}
	};

	observeMeetingApps = ({
		activeMeetingAppCount,
		captureKey,
	}: {
		activeMeetingAppCount: number;
		captureKey: string;
	}): MeetingExitTransition => {
		if (
			this.state.activeCaptureKey !== captureKey ||
			this.state.meetingAppPhase === "stop-requested"
		) {
			return null;
		}

		const hasActiveMeetingApps = activeMeetingAppCount > 0;
		if (hasActiveMeetingApps) {
			this.state.meetingAppPhase = "active";
			return "cancel";
		}

		if (this.state.meetingAppPhase !== "active") {
			return null;
		}

		this.state.meetingAppPhase = "exit-pending";
		return "schedule";
	};

	claimMeetingExit = (captureKey: string) => {
		if (
			this.state.activeCaptureKey !== captureKey ||
			this.state.meetingAppPhase !== "exit-pending"
		) {
			return false;
		}

		this.state.meetingAppPhase = "exit-evaluated";
		return true;
	};

	canStopAfterClassification = (captureKey: string) =>
		this.state.activeCaptureKey === captureKey &&
		this.state.meetingAppPhase === "exit-evaluated";
}
