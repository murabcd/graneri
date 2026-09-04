import type { useNoteTranscriptScope } from "@/hooks/use-note-transcript-scope";
import type { TranscriptSessionRepository } from "@/hooks/use-transcript-session-repository";
import { NoteTranscriptCaptureSession } from "@/lib/note-transcript-capture-session";
import {
	createEmptyLiveTranscriptState,
	createSystemAudioCaptureStatus,
	createTranscriptRecoveryStatus,
	type TranscriptUtterance,
} from "@/lib/transcript";
import type { Id } from "../../../../convex/_generated/dataModel";

const emptyTranscriptUtterances: TranscriptUtterance[] = [];

export type UseNoteTranscriptSessionArgs = {
	autoStartTranscription?: boolean;
	autoStartTranscriptionRequestId?: string | null;
	calendarEventEndAt: string | null;
	noteId: Id<"notes"> | null;
	onAutoStartTranscriptionHandled?: () => void;
	onEnhanceTranscript?: (
		transcript: string,
		transcriptionLanguage: string | null,
	) => Promise<void>;
	shouldLoadStoredTranscriptHistory?: boolean;
	transcriptionLanguage?: string | null;
};

export type ScopedTranscriptState = {
	activeTranscriptSessionId: Id<"transcriptSessions"> | null;
	captureSession: NoteTranscriptCaptureSession;
	completeSession: TranscriptSessionRepository["completeSession"];
	isTranscriptDraftReady: boolean;
	pendingGenerateTranscript: string;
	retiredScope: {
		captureSession: NoteTranscriptCaptureSession;
		completeSession: TranscriptSessionRepository["completeSession"];
	} | null;
	scopeKey: string;
	transcriptUtterances: TranscriptUtterance[];
};

export const createScopedTranscriptState = ({
	completeSession,
	isSpeechListening,
	retiredScope = null,
	scopeKey,
}: {
	completeSession: TranscriptSessionRepository["completeSession"];
	isSpeechListening: boolean;
	retiredScope?: ScopedTranscriptState["retiredScope"];
	scopeKey: string;
}): ScopedTranscriptState => ({
	activeTranscriptSessionId: null,
	captureSession: new NoteTranscriptCaptureSession({ isSpeechListening }),
	completeSession,
	isTranscriptDraftReady: false,
	pendingGenerateTranscript: "",
	retiredScope,
	scopeKey,
	transcriptUtterances: [],
});

export const getScopedTranscriptionSnapshot = ({
	isScoped,
	transcriptionSession,
}: {
	isScoped: boolean;
	transcriptionSession: ReturnType<
		typeof useNoteTranscriptScope
	>["transcriptionSession"];
}) => ({
	liveTranscript: isScoped
		? transcriptionSession.liveTranscript
		: createEmptyLiveTranscriptState(),
	recoveryStatus: isScoped
		? transcriptionSession.recoveryStatus
		: createTranscriptRecoveryStatus(),
	snapshotUtterances: isScoped
		? transcriptionSession.utterances
		: emptyTranscriptUtterances,
	systemAudioStatus: isScoped
		? transcriptionSession.systemAudioStatus
		: createSystemAudioCaptureStatus(),
});

export const getQueuedTranscriptAutoStartKey = ({
	autoStartTranscription,
	autoStartTranscriptionRequestId,
	noteId,
	transcriptionLanguage,
}: Pick<
	UseNoteTranscriptSessionArgs,
	| "autoStartTranscription"
	| "autoStartTranscriptionRequestId"
	| "noteId"
	| "transcriptionLanguage"
>) =>
	autoStartTranscription &&
	noteId &&
	autoStartTranscriptionRequestId &&
	transcriptionLanguage !== undefined
		? `${noteId}:capture:${autoStartTranscriptionRequestId}`
		: null;

export const getGeneratedTranscriptSessionId = (
	generatedSession: {
		draftKey: string;
		sessionId: Id<"transcriptSessions">;
	} | null,
	draftKey: string,
) =>
	generatedSession?.draftKey === draftKey ? generatedSession.sessionId : null;
