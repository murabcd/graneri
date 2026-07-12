import type {
	SystemAudioCaptureSourceMode,
	TranscriptUtterance,
} from "@/lib/transcript";
import { createTranscriptText } from "@/lib/transcript-session";
import type { Id } from "../../../../convex/_generated/dataModel";

type CaptureRepository = {
	appendUtterance: (args: {
		sessionId: Id<"transcriptSessions">;
		source: "live" | "refined";
		utterance: TranscriptUtterance;
	}) => Promise<null>;
	completeSession: (args: {
		sessionId: Id<"transcriptSessions">;
	}) => Promise<null>;
	startSession: (args: {
		noteId: Id<"notes">;
		systemAudioSourceMode?: SystemAudioCaptureSourceMode;
	}) => Promise<Id<"transcriptSessions">>;
};

type StoredTranscriptSession = {
	generatedNoteAt: number | null;
	sessionId: Id<"transcriptSessions">;
	utterances: TranscriptUtterance[];
};

type TranscriptDraft = {
	updatedAt: number;
	utterances: TranscriptUtterance[];
};

type SessionStartArgs = {
	noteId: Id<"notes"> | null;
	repository: CaptureRepository;
	resetStartingStopRequest: () => void;
	systemAudioSourceMode?: SystemAudioCaptureSourceMode;
	terminalizeIfStopWonStartRace: (args: {
		sessionId: Id<"transcriptSessions">;
	}) => Promise<boolean>;
};

type StoredSessionHydrationInput = {
	generatedSessionId: Id<"transcriptSessions"> | null;
	latestServerTranscript: string;
	latestSession: StoredTranscriptSession;
};

type ServerHydrationDecision = {
	isDraftReady: boolean;
	isSpeechListening: boolean;
	latestServerTranscript: string;
	latestSession: StoredTranscriptSession | null;
	latestSessionUpdatedAt: number | null;
	pendingGenerateTranscript: string;
	utteranceCount: number;
};

export class NoteTranscriptCaptureSession {
	private activeSessionId: Id<"transcriptSessions"> | null = null;
	private hasHydratedStoredSession = false;
	private hasLoadedDraftContent = false;
	private hasRestoredDraft = false;
	private lifecycleGeneration = 0;
	private lastCompletedSessionId: Id<"transcriptSessions"> | null = null;
	private loadedDraftUpdatedAt: number | null = null;
	private pendingUtteranceIds = new Set<string>();
	private persistedUtteranceIds = new Set<string>();
	private queuedUtterances: TranscriptUtterance[] = [];
	private sessionStartPromise: Promise<Id<"transcriptSessions">> | null = null;
	private systemAudioModePersistedFor: Id<"transcriptSessions"> | null = null;
	private utterances: TranscriptUtterance[] = [];
	listeningStartedAt: number | null = null;

	get activeTranscriptSessionId() {
		return this.activeSessionId;
	}

	get completedTranscriptSessionId() {
		return this.lastCompletedSessionId;
	}

	get currentUtterances() {
		return this.utterances;
	}

	get hasPendingStart() {
		return this.sessionStartPromise !== null;
	}

	get isDraftRestored() {
		return this.hasRestoredDraft;
	}

	reset() {
		this.lifecycleGeneration += 1;
		this.activeSessionId = null;
		this.hasHydratedStoredSession = false;
		this.hasLoadedDraftContent = false;
		this.hasRestoredDraft = false;
		this.lastCompletedSessionId = null;
		this.loadedDraftUpdatedAt = null;
		this.pendingUtteranceIds.clear();
		this.persistedUtteranceIds.clear();
		this.queuedUtterances = [];
		this.sessionStartPromise = null;
		this.systemAudioModePersistedFor = null;
		this.utterances = [];
		this.listeningStartedAt = null;
	}

	beginDraftRestore() {
		this.hasLoadedDraftContent = false;
		this.hasRestoredDraft = false;
		this.loadedDraftUpdatedAt = null;
	}

	restoreDraft(draft: TranscriptDraft) {
		this.hasLoadedDraftContent = true;
		this.loadedDraftUpdatedAt = draft.updatedAt;
		this.replacePersistedUtterances(draft.utterances);
		return {
			pendingGenerateTranscript: createTranscriptText(draft.utterances),
			utterances: draft.utterances,
		};
	}

	finishDraftRestore() {
		this.hasRestoredDraft = true;
	}

	shouldHydrateStoredSession({
		isDraftReady,
		isSpeechListening,
		latestServerTranscript,
		latestSession,
		latestSessionUpdatedAt,
		pendingGenerateTranscript,
		utteranceCount,
	}: ServerHydrationDecision) {
		if (
			!isDraftReady ||
			this.hasHydratedStoredSession ||
			this.activeSessionId !== null ||
			this.hasPendingStart ||
			isSpeechListening ||
			latestSession === null
		) {
			return false;
		}

		const hasNewerServerSnapshot =
			this.loadedDraftUpdatedAt !== null &&
			latestSessionUpdatedAt !== null &&
			latestSessionUpdatedAt > this.loadedDraftUpdatedAt;

		return (
			!this.hasLoadedDraftContent ||
			latestSession.generatedNoteAt !== null ||
			hasNewerServerSnapshot ||
			latestSession.utterances.length > utteranceCount ||
			latestServerTranscript.length > pendingGenerateTranscript.trim().length
		);
	}

	hydrateStoredSession({
		generatedSessionId,
		latestServerTranscript,
		latestSession,
	}: StoredSessionHydrationInput) {
		this.activeSessionId = null;
		this.hasHydratedStoredSession = true;
		this.lastCompletedSessionId = latestSession.sessionId;
		this.replacePersistedUtterances(latestSession.utterances);

		return {
			pendingGenerateTranscript:
				latestSession.generatedNoteAt ||
				latestSession.sessionId === generatedSessionId
					? ""
					: latestServerTranscript,
			utterances: latestSession.utterances,
		};
	}

	clearLoadedDraft() {
		const hadLoadedDraft = this.hasLoadedDraftContent;
		this.hasLoadedDraftContent = false;
		this.loadedDraftUpdatedAt = null;
		return hadLoadedDraft;
	}

	markListeningStarted(now: number) {
		this.listeningStartedAt = now;
	}

	markListeningStopped() {
		const completedSessionId = this.activeSessionId;
		this.activeSessionId = null;
		this.lastCompletedSessionId = completedSessionId;
		this.systemAudioModePersistedFor = null;

		return {
			completedSessionId,
			completedTranscript: createTranscriptText(this.utterances),
		};
	}

	async ensureSession({
		noteId,
		repository,
		resetStartingStopRequest,
		systemAudioSourceMode,
		terminalizeIfStopWonStartRace,
	}: SessionStartArgs) {
		if (!noteId) {
			return null;
		}

		if (this.activeSessionId) {
			return this.activeSessionId;
		}

		if (this.sessionStartPromise) {
			return await this.sessionStartPromise;
		}

		this.persistedUtteranceIds.clear();
		this.pendingUtteranceIds.clear();
		resetStartingStopRequest();
		const lifecycleGeneration = this.lifecycleGeneration;
		const startPromise = repository
			.startSession({ noteId, systemAudioSourceMode })
			.then(async (sessionId) => {
				if (lifecycleGeneration !== this.lifecycleGeneration) {
					await repository.completeSession({ sessionId });
					return sessionId;
				}

				if (await terminalizeIfStopWonStartRace({ sessionId })) {
					return sessionId;
				}

				this.activeSessionId = sessionId;
				this.lastCompletedSessionId = null;
				this.systemAudioModePersistedFor = systemAudioSourceMode
					? sessionId
					: null;
				await this.flushQueuedUtterances(sessionId, repository);
				return sessionId;
			})
			.finally(() => {
				if (this.lifecycleGeneration === lifecycleGeneration) {
					this.sessionStartPromise = null;
				}
			});

		this.sessionStartPromise = startPromise;
		return await startPromise;
	}

	recordUtterance(utterance: TranscriptUtterance) {
		this.utterances = [...this.utterances, utterance];
		if (!this.activeSessionId) {
			this.queuedUtterances.push(utterance);
		}

		return {
			activeSessionId: this.activeSessionId,
			transcript: createTranscriptText(this.utterances),
			utterances: this.utterances,
		};
	}

	async persistUtterance(
		sessionId: Id<"transcriptSessions">,
		utterance: TranscriptUtterance,
		repository: CaptureRepository,
	) {
		if (
			this.persistedUtteranceIds.has(utterance.id) ||
			this.pendingUtteranceIds.has(utterance.id)
		) {
			return;
		}

		this.pendingUtteranceIds.add(utterance.id);
		try {
			await repository.appendUtterance({
				sessionId,
				source: "live",
				utterance,
			});
			this.persistedUtteranceIds.add(utterance.id);
		} finally {
			this.pendingUtteranceIds.delete(utterance.id);
		}
	}

	claimSystemAudioModePersistence() {
		if (
			!this.activeSessionId ||
			this.systemAudioModePersistedFor === this.activeSessionId
		) {
			return null;
		}

		this.systemAudioModePersistedFor = this.activeSessionId;
		return this.activeSessionId;
	}

	releaseSystemAudioModePersistence(sessionId: Id<"transcriptSessions">) {
		if (this.systemAudioModePersistedFor === sessionId) {
			this.systemAudioModePersistedFor = null;
		}
	}

	markGenerated(sessionId: Id<"transcriptSessions">) {
		this.lastCompletedSessionId = sessionId;
	}

	clearAfterGeneration() {
		this.lifecycleGeneration += 1;
		this.activeSessionId = null;
		this.sessionStartPromise = null;
		this.systemAudioModePersistedFor = null;
	}

	private async flushQueuedUtterances(
		sessionId: Id<"transcriptSessions">,
		repository: CaptureRepository,
	) {
		const queuedUtterances = this.queuedUtterances;
		this.queuedUtterances = [];
		await Promise.all(
			queuedUtterances.map((utterance) =>
				this.persistUtterance(sessionId, utterance, repository),
			),
		);
	}

	private replacePersistedUtterances(utterances: TranscriptUtterance[]) {
		this.utterances = utterances;
		this.pendingUtteranceIds.clear();
		this.persistedUtteranceIds = new Set(
			utterances.map((utterance) => utterance.id),
		);
	}
}
