import {
	isDesktopRuntime,
	onDesktopMeetingDetectionState,
} from "@workspace/platform/desktop";
import * as React from "react";
import { useNoteTranscriptScope } from "@/hooks/use-note-transcript-scope";
import type { TranscriptSessionRepository } from "@/hooks/use-transcript-session-repository";
import { useTranscriptSessionStopController } from "@/hooks/use-transcript-session-stop-controller";
import { logError } from "@/lib/logger";
import { NoteTranscriptCaptureSession } from "@/lib/note-transcript-capture-session";
import {
	createStoredTranscriptText,
	createVisibleTranscriptView,
	mergeTranscriptUtterances,
	resolveTranscriptSessionLanguage,
	resolveTranscriptSessionReady,
} from "@/lib/note-transcript-session-view";
import {
	createEmptyLiveTranscriptState,
	createLiveTranscriptEntries,
	createSystemAudioCaptureStatus,
	createTranscriptRecoveryStatus,
	type LiveTranscriptState,
	type TranscriptUtterance,
} from "@/lib/transcript";
import { createTranscriptText } from "@/lib/transcript-session";
import { TranscriptionAutoStopController } from "@/lib/transcription-auto-stop";
import { transcriptionSessionManager } from "@/lib/transcription-session-manager";
import type { Id } from "../../../../convex/_generated/dataModel";

const transcriptIdleStopMs = 15 * 60 * 1000;
const transcriptIdleCheckIntervalMs = 15 * 1000;
const emptyTranscriptUtterances: TranscriptUtterance[] = [];

type UseNoteTranscriptSessionArgs = {
	autoStartTranscription?: boolean;
	autoStartTranscriptionRequestId?: string | null;
	noteId: Id<"notes"> | null;
	onAutoStartTranscriptionHandled?: () => void;
	onEnhanceTranscript?: (
		transcript: string,
		transcriptionLanguage: string | null,
	) => Promise<void>;
	shouldLoadStoredTranscriptHistory?: boolean;
	stopTranscriptionWhenMeetingEnds?: boolean;
	transcriptionLanguage?: string | null;
};

type ScopedTranscriptState = {
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

const createScopedTranscriptState = ({
	completeSession,
	isSpeechListening,
	retiredScope = null,
	scopeKey,
}: {
	completeSession: TranscriptSessionRepository["completeSession"];
	isSpeechListening: boolean;
	retiredScope?: ScopedTranscriptState["retiredScope"];
	scopeKey: string;
}): ScopedTranscriptState => {
	const captureSession = new NoteTranscriptCaptureSession({
		isSpeechListening,
	});

	return {
		activeTranscriptSessionId: null,
		captureSession,
		completeSession,
		isTranscriptDraftReady: false,
		pendingGenerateTranscript: "",
		retiredScope,
		scopeKey,
		transcriptUtterances: [],
	};
};

export const useNoteTranscriptSession = ({
	autoStartTranscription,
	autoStartTranscriptionRequestId,
	noteId,
	onAutoStartTranscriptionHandled,
	onEnhanceTranscript,
	shouldLoadStoredTranscriptHistory = false,
	stopTranscriptionWhenMeetingEnds,
	transcriptionLanguage,
}: UseNoteTranscriptSessionArgs) => {
	const [isGeneratingNotes, setIsGeneratingNotes] = React.useState(false);
	const [generatedTranscriptSession, setGeneratedTranscriptSession] =
		React.useState<{
			draftKey: string;
			sessionId: Id<"transcriptSessions">;
		} | null>(null);
	const [pendingAutoStartKey, setPendingAutoStartKey] = React.useState<
		string | null
	>(null);
	const lastQueuedAutoStartKeyRef = React.useRef<string | null>(null);
	const hasHandledAutoStartRef = React.useRef(false);
	const transcriptionAutoStopStateRef =
		React.useRef<TranscriptionAutoStopController | null>(null);
	if (transcriptionAutoStopStateRef.current === null) {
		transcriptionAutoStopStateRef.current =
			new TranscriptionAutoStopController();
	}
	const transcriptionAutoStopState = transcriptionAutoStopStateRef.current;
	const [initialLastAudioActivityAt] = React.useState(Date.now);
	const lastAudioActivityAtRef = React.useRef<number | null>(
		initialLastAudioActivityAt,
	);
	const {
		captureScopeKey,
		captureScopeNoteId,
		captureTranscriptDraftKey,
		captureTranscriptSessionRepository,
		currentNoteScopeKey,
		effectiveCurrentNoteTranscriptSessionRepository,
		isCurrentNoteSpeechListening,
		isScopedTranscriptionSession,
		isSpeechListening,
		isViewingCaptureScope,
		resolvedCaptureScopeKey,
		setCaptureScopeKey,
		transcriptionSession,
	} = useNoteTranscriptScope({
		// Transcript scope follows the active note route/context.
		noteId,
		// Stored history loading is an input to transcript scope hydration.
		shouldLoadStoredTranscriptHistory,
	});
	const completeCaptureTranscriptSession =
		captureTranscriptSessionRepository.completeSession;
	const [scopedTranscriptState, setScopedTranscriptState] =
		React.useState<ScopedTranscriptState>(() =>
			createScopedTranscriptState({
				completeSession: completeCaptureTranscriptSession,
				isSpeechListening,
				scopeKey: captureTranscriptDraftKey,
			}),
		);
	if (scopedTranscriptState.scopeKey !== captureTranscriptDraftKey) {
		setScopedTranscriptState(
			createScopedTranscriptState({
				completeSession: completeCaptureTranscriptSession,
				isSpeechListening,
				retiredScope: {
					captureSession: scopedTranscriptState.captureSession,
					completeSession: scopedTranscriptState.completeSession,
				},
				scopeKey: captureTranscriptDraftKey,
			}),
		);
	}
	const {
		activeTranscriptSessionId,
		captureSession,
		isTranscriptDraftReady,
		pendingGenerateTranscript,
		transcriptUtterances,
	} = scopedTranscriptState;
	const retiredTranscriptScope = scopedTranscriptState.retiredScope;
	const updateScopedTranscriptState = React.useCallback(
		(update: (state: ScopedTranscriptState) => ScopedTranscriptState) => {
			setScopedTranscriptState((currentState) =>
				currentState.scopeKey === captureTranscriptDraftKey
					? update(currentState)
					: currentState,
			);
		},
		[captureTranscriptDraftKey],
	);
	const generatedTranscriptSessionId =
		generatedTranscriptSession?.draftKey === captureTranscriptDraftKey
			? generatedTranscriptSession.sessionId
			: null;
	const systemAudioStatus = isScopedTranscriptionSession
		? transcriptionSession.systemAudioStatus
		: createSystemAudioCaptureStatus();
	const recoveryStatus = isScopedTranscriptionSession
		? transcriptionSession.recoveryStatus
		: createTranscriptRecoveryStatus();
	const liveTranscript = React.useMemo<LiveTranscriptState>(
		() =>
			isScopedTranscriptionSession
				? transcriptionSession.liveTranscript
				: createEmptyLiveTranscriptState(),
		[isScopedTranscriptionSession, transcriptionSession.liveTranscript],
	);
	const scopedSnapshotUtterances = isScopedTranscriptionSession
		? transcriptionSession.utterances
		: emptyTranscriptUtterances;
	const transcriptSessionStopController = useTranscriptSessionStopController({
		isSpeechListening,
		repository: captureTranscriptSessionRepository,
		stopCapture: transcriptionSessionManager.controller.stop,
	});

	const orderedTranscriptUtterances = React.useMemo(
		() =>
			mergeTranscriptUtterances(transcriptUtterances, scopedSnapshotUtterances),
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
		[scopedSnapshotUtterances, transcriptUtterances],
	);

	const liveTranscriptEntries = React.useMemo(
		() => createLiveTranscriptEntries(liveTranscript),
		[liveTranscript],
	);

	const hasPendingGenerateTranscript = Boolean(
		pendingGenerateTranscript.trim(),
	);
	const captureLatestTranscriptSession =
		captureTranscriptSessionRepository.latestTranscriptSession;
	const captureLatestTranscriptSessionSummary =
		captureTranscriptSessionRepository.latestTranscriptSessionSummary;
	const currentNoteLatestTranscriptSession =
		effectiveCurrentNoteTranscriptSessionRepository.latestTranscriptSession;
	const currentNoteLatestTranscriptSessionSummary =
		effectiveCurrentNoteTranscriptSessionRepository.latestTranscriptSessionSummary;
	const latestTranscriptSessionSummary = isViewingCaptureScope
		? captureLatestTranscriptSessionSummary
		: currentNoteLatestTranscriptSessionSummary;
	const currentNoteStoredTranscript = React.useMemo(
		() =>
			createStoredTranscriptText({
				session: currentNoteLatestTranscriptSession,
				summary: currentNoteLatestTranscriptSessionSummary,
			}),
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
		[
			currentNoteLatestTranscriptSession,
			currentNoteLatestTranscriptSessionSummary,
		],
	);
	const {
		visibleDisplayTranscriptEntries,
		visibleExportTranscript,
		visibleFullTranscript,
		visibleLiveTranscriptEntries,
		visibleOrderedTranscriptUtterances,
		visibleTranscriptStartedAt,
	} = React.useMemo(
		() =>
			createVisibleTranscriptView({
				currentNoteLatestTranscriptSession,
				isViewingCaptureScope,
				listeningStartedAt: captureSession.listeningStartedAt,
				liveTranscript,
				orderedTranscriptUtterances,
			}),
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
		[
			currentNoteLatestTranscriptSession,
			captureSession.listeningStartedAt,
			isViewingCaptureScope,
			liveTranscript,
			orderedTranscriptUtterances,
		],
	);
	const isStoredTranscriptLoading = isViewingCaptureScope
		? captureTranscriptSessionRepository.isLatestTranscriptSessionLoading
		: effectiveCurrentNoteTranscriptSessionRepository.isLatestTranscriptSessionLoading;
	const hasGeneratedLatestTranscript = Boolean(
		latestTranscriptSessionSummary?.generatedNoteAt ||
			(latestTranscriptSessionSummary &&
				latestTranscriptSessionSummary.sessionId ===
					generatedTranscriptSessionId),
	);
	const captureStoredTranscript =
		captureLatestTranscriptSession?.finalTranscript?.trim() ||
		captureLatestTranscriptSessionSummary?.finalTranscript?.trim() ||
		"";
	const hasLocalCaptureTranscript = Boolean(
		pendingGenerateTranscript.trim() ||
			orderedTranscriptUtterances.length > 0 ||
			captureStoredTranscript,
	);
	const isTranscriptSessionReady = resolveTranscriptSessionReady({
		hasLocalCaptureTranscript,
		isDraftReady: isTranscriptDraftReady,
		isSummaryLoading:
			captureTranscriptSessionRepository.isLatestTranscriptSessionSummaryLoading,
		isViewingCaptureScope,
	});
	const visibleHasPendingGenerateTranscript = isViewingCaptureScope
		? hasPendingGenerateTranscript || hasLocalCaptureTranscript
		: Boolean(currentNoteStoredTranscript.trim());
	const queuedAutoStartKey =
		autoStartTranscription &&
		noteId &&
		autoStartTranscriptionRequestId &&
		transcriptionLanguage !== undefined
			? `${noteId}:capture:${autoStartTranscriptionRequestId}`
			: null;
	const currentPendingAutoStartKey =
		pendingAutoStartKey === queuedAutoStartKey ? pendingAutoStartKey : null;

	React.useEffect(() => {
		if (isSpeechListening) {
			return;
		}

		// Capture scope follows route state only when no live recording owns the scope.
		setCaptureScopeKey((currentScopeKey) =>
			currentScopeKey === resolvedCaptureScopeKey
				? currentScopeKey
				: resolvedCaptureScopeKey,
		);
	}, [isSpeechListening, resolvedCaptureScopeKey, setCaptureScopeKey]);

	React.useEffect(() => {
		if (!queuedAutoStartKey) {
			lastQueuedAutoStartKeyRef.current = null;
			return;
		}

		if (lastQueuedAutoStartKeyRef.current === queuedAutoStartKey) {
			return;
		}

		lastQueuedAutoStartKeyRef.current = queuedAutoStartKey;
		transcriptionAutoStopState.queueMeetingAutoStart({
			enabled: stopTranscriptionWhenMeetingEnds === true && isDesktopRuntime(),
		});
		// Auto-start is a one-shot route request latch, not render-derived state.
		setPendingAutoStartKey(queuedAutoStartKey);
	}, [
		queuedAutoStartKey,
		stopTranscriptionWhenMeetingEnds,
		transcriptionAutoStopState,
	]);

	React.useEffect(() => {
		if (!currentPendingAutoStartKey) {
			return;
		}

		const timeoutId = window.setTimeout(() => {
			setPendingAutoStartKey((currentValue) =>
				currentValue === currentPendingAutoStartKey ? null : currentValue,
			);
		}, 0);

		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [currentPendingAutoStartKey]);

	React.useEffect(() => {
		// Latch meeting-controlled auto-stop for the active capture even after
		// the route/query state is cleaned up post-start.
		transcriptionAutoStopState.latchMeetingAutoStop({
			enabled: stopTranscriptionWhenMeetingEnds === true && isDesktopRuntime(),
		});
	}, [stopTranscriptionWhenMeetingEnds, transcriptionAutoStopState]);

	React.useEffect(() => {
		if (!isDesktopRuntime()) {
			return;
		}

		return onDesktopMeetingDetectionState((state) => {
			if (
				transcriptionAutoStopState.observeMeetingSignal({
					hasMeetingSignal: state.hasMeetingSignal,
					isSpeechListening,
				})
			) {
				void transcriptSessionStopController
					.stopCaptureAfterRequest({
						activeSessionId: captureSession.activeTranscriptSessionId,
						hasPendingStart: captureSession.hasPendingStart,
						reason: "note-transcript-meeting-ended-auto-stop",
					})
					.catch((error) => {
						logError({
							event: "client.error",
							error,
							message: "Failed to stop transcript session after meeting ended",
						});
					});
			}
		});
	}, [
		isSpeechListening,
		captureSession,
		transcriptSessionStopController,
		transcriptionAutoStopState,
	]);

	const restoreTranscriptDraft = React.useCallback(
		(draft: {
			pendingGenerateTranscript: string;
			updatedAt: number;
			utterances: TranscriptUtterance[];
		}) => {
			const restoredDraft = captureSession.restoreDraft(draft);
			updateScopedTranscriptState((currentState) => ({
				...currentState,
				pendingGenerateTranscript: restoredDraft.pendingGenerateTranscript,
				transcriptUtterances: restoredDraft.utterances,
			}));
		},
		[captureSession, updateScopedTranscriptState],
	);

	const hydrateStoredTranscriptSession = React.useCallback(
		({
			generatedSessionId,
			latestServerTranscript,
			latestSession,
		}: {
			generatedSessionId: Id<"transcriptSessions"> | null;
			latestServerTranscript: string;
			latestSession: {
				generatedNoteAt: number | null;
				sessionId: Id<"transcriptSessions">;
				utterances: TranscriptUtterance[];
			};
		}) => {
			const hydration = captureSession.hydrateStoredSession({
				generatedSessionId,
				latestServerTranscript,
				latestSession,
			});
			updateScopedTranscriptState((currentState) => ({
				...currentState,
				pendingGenerateTranscript: hydration.pendingGenerateTranscript,
				transcriptUtterances: hydration.utterances,
			}));
		},
		[captureSession, updateScopedTranscriptState],
	);

	const markSpeechListeningStarted = React.useCallback(() => {
		const now = Date.now();
		captureSession.markListeningStarted(now);
		updateScopedTranscriptState((currentState) => ({
			...currentState,
			pendingGenerateTranscript: "",
		}));
		transcriptionAutoStopState.resetRequest();
		lastAudioActivityAtRef.current = now;
	}, [captureSession, transcriptionAutoStopState, updateScopedTranscriptState]);

	const markSpeechListeningStopped = React.useCallback(() => {
		transcriptionAutoStopState.reset();
		const { completedSessionId, completedTranscript } =
			captureSession.markListeningStopped();
		if (completedTranscript) {
			updateScopedTranscriptState((currentState) => ({
				...currentState,
				pendingGenerateTranscript: completedTranscript,
			}));
		}

		updateScopedTranscriptState((currentState) => ({
			...currentState,
			activeTranscriptSessionId: null,
		}));
		return completedSessionId;
	}, [captureSession, transcriptionAutoStopState, updateScopedTranscriptState]);

	const ensureTranscriptSession = React.useCallback(async () => {
		try {
			const sessionId = await captureSession.ensureSession({
				noteId: captureScopeNoteId,
				repository: captureTranscriptSessionRepository,
				resetStartingStopRequest:
					transcriptSessionStopController.resetStartingStopRequest,
				systemAudioSourceMode:
					systemAudioStatus.state === "connected"
						? systemAudioStatus.sourceMode
						: undefined,
				transcriptionLanguage: transcriptionLanguage ?? null,
				terminalizeIfStopWonStartRace:
					transcriptSessionStopController.terminalizeIfStopWonStartRace,
			});
			updateScopedTranscriptState((currentState) => ({
				...currentState,
				activeTranscriptSessionId: captureSession.activeTranscriptSessionId,
			}));
			return sessionId;
		} catch (error) {
			logError({
				event: "client.error",
				error,
				message: "Failed to start transcript session",
			});
			return null;
		}
	}, [
		captureSession,
		captureScopeNoteId,
		systemAudioStatus.sourceMode,
		systemAudioStatus.state,
		transcriptionLanguage,
		captureTranscriptSessionRepository,
		transcriptSessionStopController,
		updateScopedTranscriptState,
	]);

	React.useEffect(() => {
		if (!retiredTranscriptScope) {
			return;
		}

		const activeSessionId =
			retiredTranscriptScope.captureSession.activeTranscriptSessionId;
		retiredTranscriptScope.captureSession.reset();
		if (!activeSessionId) {
			return;
		}

		void retiredTranscriptScope
			.completeSession({
				sessionId: activeSessionId,
			})
			.catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message:
						"Failed to complete transcript session while switching notes",
				});
			});
	}, [retiredTranscriptScope]);

	React.useEffect(() => {
		let isCancelled = false;
		captureSession.beginDraftRestore();
		updateScopedTranscriptState((currentState) => ({
			...currentState,
			isTranscriptDraftReady: false,
		}));
		void captureTranscriptSessionRepository
			.loadDraft(captureTranscriptDraftKey)
			.then((draft) => {
				if (isCancelled || !draft) {
					return;
				}

				restoreTranscriptDraft(draft);
			})
			.finally(() => {
				if (!isCancelled) {
					captureSession.finishDraftRestore();
					updateScopedTranscriptState((currentState) => ({
						...currentState,
						isTranscriptDraftReady: true,
					}));
				}
			});

		return () => {
			isCancelled = true;
		};
	}, [
		captureSession,
		captureTranscriptDraftKey,
		captureTranscriptSessionRepository.loadDraft,
		restoreTranscriptDraft,
		updateScopedTranscriptState,
	]);

	React.useEffect(() => {
		const latestSession = captureLatestTranscriptSession;
		const latestSessionSummary = captureLatestTranscriptSessionSummary;
		const latestServerTranscript = latestSession
			? createTranscriptText(latestSession.utterances) ||
				latestSession.finalTranscript
			: (latestSessionSummary?.finalTranscript ?? "");
		const latestSessionUpdatedAt =
			latestSessionSummary?.updatedAt ?? latestSession?.updatedAt ?? null;
		const shouldHydrateFromServer = captureSession.shouldHydrateStoredSession({
			isDraftReady: isTranscriptDraftReady,
			isSpeechListening: captureSession.isSpeechListening || isSpeechListening,
			latestServerTranscript,
			latestSession: latestSession ?? null,
			latestSessionUpdatedAt,
			pendingGenerateTranscript,
			utteranceCount: transcriptUtterances.length,
		});

		if (!shouldHydrateFromServer || !latestSession) {
			return;
		}

		hydrateStoredTranscriptSession({
			generatedSessionId: generatedTranscriptSessionId,
			latestServerTranscript,
			latestSession,
		});
		if (captureSession.clearLoadedDraft()) {
			void captureTranscriptSessionRepository.clearDraft(
				captureTranscriptDraftKey,
			);
		}
	}, [
		captureSession,
		captureLatestTranscriptSession,
		captureLatestTranscriptSessionSummary,
		captureTranscriptDraftKey,
		captureTranscriptSessionRepository,
		generatedTranscriptSessionId,
		hydrateStoredTranscriptSession,
		isSpeechListening,
		isTranscriptDraftReady,
		pendingGenerateTranscript,
		transcriptUtterances.length,
	]);

	React.useEffect(() => {
		if (!captureSession.isDraftRestored || !isTranscriptDraftReady) {
			return;
		}

		void captureTranscriptSessionRepository.saveDraft({
			noteKey: captureTranscriptDraftKey,
			utterances: transcriptUtterances,
			liveTranscript,
			pendingGenerateTranscript,
		});
	}, [
		captureSession,
		isTranscriptDraftReady,
		liveTranscript,
		pendingGenerateTranscript,
		captureTranscriptDraftKey,
		transcriptUtterances,
		captureTranscriptSessionRepository,
	]);

	React.useEffect(() => {
		if (!isSpeechListening) {
			return;
		}

		void ensureTranscriptSession();
	}, [ensureTranscriptSession, isSpeechListening]);

	React.useEffect(() => {
		if (liveTranscriptEntries.some((entry) => entry.text.trim().length > 0)) {
			lastAudioActivityAtRef.current = Date.now();
		}
	}, [liveTranscriptEntries]);

	React.useEffect(() => {
		if (!isSpeechListening) {
			return;
		}

		const intervalId = window.setInterval(() => {
			if (
				transcriptionAutoStopState.hasRequestedStop() ||
				Date.now() - (lastAudioActivityAtRef.current ?? Date.now()) <
					transcriptIdleStopMs
			) {
				return;
			}

			transcriptionAutoStopState.markRequested();
			void transcriptSessionStopController
				.stopCaptureAfterRequest({
					activeSessionId: captureSession.activeTranscriptSessionId,
					hasPendingStart: captureSession.hasPendingStart,
					reason: "note-transcript-idle-auto-stop",
				})
				.catch((error) => {
					logError({
						event: "client.error",
						error,
						message: "Failed to stop idle transcript session",
					});
				});
		}, transcriptIdleCheckIntervalMs);

		return () => window.clearInterval(intervalId);
	}, [
		captureSession,
		isSpeechListening,
		transcriptSessionStopController,
		transcriptionAutoStopState,
	]);

	React.useEffect(() => {
		if (systemAudioStatus.state !== "connected") {
			return;
		}

		const sessionId = captureSession.claimSystemAudioModePersistence();
		if (!sessionId) {
			return;
		}

		void captureTranscriptSessionRepository
			.setSystemAudioSourceMode({
				sessionId,
				systemAudioSourceMode: systemAudioStatus.sourceMode,
			})
			.catch((error) => {
				captureSession.releaseSystemAudioModePersistence(sessionId);
				logError({
					event: "client.error",
					error: error,
					message: "Failed to persist transcript session system audio",
				});
			});
	}, [
		captureSession,
		captureTranscriptSessionRepository,
		systemAudioStatus.sourceMode,
		systemAudioStatus.state,
	]);

	React.useEffect(() => {
		if (!autoStartTranscription) {
			hasHandledAutoStartRef.current = false;
			return;
		}

		if (!isSpeechListening || hasHandledAutoStartRef.current) {
			return;
		}

		hasHandledAutoStartRef.current = true;
		onAutoStartTranscriptionHandled?.();
	}, [
		autoStartTranscription,
		isSpeechListening,
		onAutoStartTranscriptionHandled,
	]);

	const handleGenerateNotes = React.useCallback(() => {
		const transcript = isViewingCaptureScope
			? pendingGenerateTranscript.trim() ||
				createTranscriptText(captureSession.currentUtterances) ||
				captureStoredTranscript
			: currentNoteStoredTranscript.trim();

		if (!transcript || isGeneratingNotes || !onEnhanceTranscript) {
			return;
		}

		const targetTranscriptSessionRepository = isViewingCaptureScope
			? captureTranscriptSessionRepository
			: effectiveCurrentNoteTranscriptSessionRepository;
		const targetTranscriptDraftKey = isViewingCaptureScope
			? captureTranscriptDraftKey
			: currentNoteScopeKey;
		const targetSessionId = isViewingCaptureScope
			? (captureSession.completedTranscriptSessionId ??
				captureSession.activeTranscriptSessionId)
			: (currentNoteLatestTranscriptSessionSummary?.sessionId ??
				currentNoteLatestTranscriptSession?.sessionId ??
				null);
		const targetTranscriptionLanguage = isViewingCaptureScope
			? resolveTranscriptSessionLanguage({
					fallbackLanguage: transcriptionLanguage,
					session: captureLatestTranscriptSession,
					summary: captureLatestTranscriptSessionSummary,
				})
			: resolveTranscriptSessionLanguage({
					session: currentNoteLatestTranscriptSession,
					summary: currentNoteLatestTranscriptSessionSummary,
				});

		setIsGeneratingNotes(true);
		void (async () => {
			try {
				await onEnhanceTranscript(transcript, targetTranscriptionLanguage);

				if (targetSessionId) {
					await targetTranscriptSessionRepository.markGenerated({
						sessionId: targetSessionId,
					});
					if (isViewingCaptureScope) {
						setGeneratedTranscriptSession({
							draftKey: captureTranscriptDraftKey,
							sessionId: targetSessionId,
						});
						captureSession.markGenerated(targetSessionId);
					}
				}

				await targetTranscriptSessionRepository.clearDraft(
					targetTranscriptDraftKey,
				);
				if (isViewingCaptureScope) {
					updateScopedTranscriptState((currentState) => ({
						...currentState,
						activeTranscriptSessionId: null,
						pendingGenerateTranscript: "",
					}));
					captureSession.clearAfterGeneration();
				}
			} catch (error) {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to generate notes from transcript",
				});
			} finally {
				setIsGeneratingNotes(false);
			}
		})();
	}, [
		captureSession,
		captureLatestTranscriptSession,
		captureLatestTranscriptSessionSummary,
		captureTranscriptDraftKey,
		captureTranscriptSessionRepository,
		captureStoredTranscript,
		currentNoteLatestTranscriptSession,
		currentNoteLatestTranscriptSessionSummary,
		currentNoteScopeKey,
		currentNoteStoredTranscript,
		effectiveCurrentNoteTranscriptSessionRepository,
		isViewingCaptureScope,
		isGeneratingNotes,
		onEnhanceTranscript,
		pendingGenerateTranscript,
		transcriptionLanguage,
		updateScopedTranscriptState,
	]);

	const handleTranscriptUtterance = React.useCallback(
		(utterance: TranscriptUtterance) => {
			lastAudioActivityAtRef.current = Date.now();
			const recordedUtterance = captureSession.recordUtterance(utterance);
			updateScopedTranscriptState((currentState) => ({
				...currentState,
				pendingGenerateTranscript: recordedUtterance.transcript,
				transcriptUtterances: recordedUtterance.utterances,
			}));

			const activeSessionId = recordedUtterance.activeSessionId;
			if (activeSessionId) {
				void captureSession
					.persistUtterance(
						activeSessionId,
						utterance,
						captureTranscriptSessionRepository,
					)
					.catch((error) => {
						logError({
							event: "client.error",
							error: error,
							message: "Failed to persist transcript utterance",
						});
					});
				return;
			}
		},
		[
			captureSession,
			captureTranscriptSessionRepository,
			updateScopedTranscriptState,
		],
	);

	React.useEffect(() => {
		return transcriptionSessionManager.store.subscribeToEvents((event) => {
			const snapshot = transcriptionSessionManager.store.getSnapshot();
			if (
				event.type === "session.state_patch" &&
				event.patch.isListening !== undefined
			) {
				const nextIsSpeechListening =
					snapshot.scopeKey === captureScopeKey && snapshot.isListening;
				const listeningTransition = captureSession.observeSpeechListening(
					nextIsSpeechListening,
				);
				if (listeningTransition === "started") {
					markSpeechListeningStarted();
				}

				if (listeningTransition === "stopped") {
					const completedSessionId = markSpeechListeningStopped();
					if (completedSessionId) {
						void completeCaptureTranscriptSession({
							sessionId: completedSessionId,
						}).catch((error) => {
							logError({
								event: "client.error",
								error: error,
								message: "Failed to complete transcript session",
							});
						});
					}
				}
			}

			if (
				snapshot.scopeKey === captureScopeKey &&
				event.type === "session.utterance_committed"
			) {
				handleTranscriptUtterance(event.utterance);
			}
		});
	}, [
		captureScopeKey,
		captureSession,
		completeCaptureTranscriptSession,
		handleTranscriptUtterance,
		markSpeechListeningStarted,
		markSpeechListeningStopped,
	]);

	return {
		activeTranscriptSessionId,
		autoStartKey: currentPendingAutoStartKey,
		captureScopeKey,
		currentNoteScopeKey: resolvedCaptureScopeKey,
		exportTranscript: visibleExportTranscript,
		fullTranscript: visibleFullTranscript,
		handleGenerateNotes,
		hasGeneratedLatestTranscript,
		hasPendingGenerateTranscript: visibleHasPendingGenerateTranscript,
		isCurrentNoteSpeechListening,
		isStoredTranscriptLoading,
		isTranscriptSessionReady,
		isGeneratingNotes,
		isSpeechListening,
		displayTranscriptEntries: visibleDisplayTranscriptEntries,
		liveTranscriptEntries: visibleLiveTranscriptEntries,
		orderedTranscriptUtterances: visibleOrderedTranscriptUtterances,
		recoveryStatus: isViewingCaptureScope
			? recoveryStatus
			: createTranscriptRecoveryStatus(),
		systemAudioStatus: isViewingCaptureScope
			? systemAudioStatus
			: createSystemAudioCaptureStatus(),
		transcriptStartedAt: visibleTranscriptStartedAt,
	};
};
