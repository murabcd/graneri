import { expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { NoteTranscriptCaptureSession } from "../src/lib/note-transcript-capture-session";
import type { TranscriptUtterance } from "../src/lib/transcript";

const noteId = "note-1" as Id<"notes">;
const sessionId = "session-1" as Id<"transcriptSessions">;
const utterance: TranscriptUtterance = {
	id: "utterance-1",
	speaker: "you",
	text: "First thought",
	startedAt: 10,
	endedAt: 20,
};

const createRepository = () => ({
	appendUtterance: vi.fn(async () => null),
	completeSession: vi.fn(async () => null),
	startSession: vi.fn(async () => sessionId),
});

const createStartArgs = (repository: ReturnType<typeof createRepository>) => ({
	noteId,
	repository,
	resetStartingStopRequest: vi.fn(),
	transcriptionLanguage: "en",
	terminalizeIfStopWonStartRace: vi.fn(async () => false),
});

it("owns listening transitions without repeating state changes", () => {
	const captureSession = new NoteTranscriptCaptureSession();

	expect(captureSession.observeSpeechListening(true)).toBe("started");
	expect(captureSession.isSpeechListening).toBe(true);
	expect(captureSession.observeSpeechListening(true)).toBeNull();
	expect(captureSession.observeSpeechListening(false)).toBe("stopped");
	expect(captureSession.isSpeechListening).toBe(false);
	expect(captureSession.observeSpeechListening(false)).toBeNull();

	captureSession.reset();
	expect(captureSession.observeSpeechListening(true)).toBe("started");
});

it("deduplicates concurrent starts and flushes utterances recorded while starting", async () => {
	let resolveStart: ((value: Id<"transcriptSessions">) => void) | null = null;
	const repository = createRepository();
	repository.startSession.mockImplementationOnce(
		async () =>
			await new Promise<Id<"transcriptSessions">>((resolve) => {
				resolveStart = resolve;
			}),
	);
	const captureSession = new NoteTranscriptCaptureSession();
	const startArgs = createStartArgs(repository);
	const firstStart = captureSession.ensureSession(startArgs);
	const secondStart = captureSession.ensureSession(startArgs);

	captureSession.recordUtterance(utterance);
	expect(repository.startSession).toHaveBeenCalledTimes(1);
	expect(repository.startSession).toHaveBeenCalledWith({
		noteId,
		systemAudioSourceMode: undefined,
		transcriptionLanguage: "en",
	});
	expect(captureSession.hasPendingStart).toBe(true);

	resolveStart?.(sessionId);
	await expect(Promise.all([firstStart, secondStart])).resolves.toEqual([
		sessionId,
		sessionId,
	]);
	expect(repository.appendUtterance).toHaveBeenCalledWith({
		sessionId,
		source: "live",
		utterance,
	});
	expect(captureSession.activeTranscriptSessionId).toBe(sessionId);
});

it("does not activate a session when stop wins the start race", async () => {
	const repository = createRepository();
	const captureSession = new NoteTranscriptCaptureSession();
	const startArgs = createStartArgs(repository);
	startArgs.terminalizeIfStopWonStartRace.mockResolvedValueOnce(true);

	await expect(captureSession.ensureSession(startArgs)).resolves.toBe(
		sessionId,
	);
	expect(captureSession.activeTranscriptSessionId).toBeNull();
});

it("persists a duplicate utterance only once while the first append is pending", async () => {
	let resolveAppend: (() => void) | null = null;
	const repository = createRepository();
	repository.appendUtterance.mockImplementationOnce(
		async () =>
			await new Promise<null>((resolve) => {
				resolveAppend = () => resolve(null);
			}),
	);
	const captureSession = new NoteTranscriptCaptureSession();
	await captureSession.ensureSession(createStartArgs(repository));

	const firstAppend = captureSession.persistUtterance(
		sessionId,
		utterance,
		repository,
	);
	const duplicateAppend = captureSession.persistUtterance(
		sessionId,
		utterance,
		repository,
	);

	expect(repository.appendUtterance).toHaveBeenCalledTimes(1);
	resolveAppend?.();
	await Promise.all([firstAppend, duplicateAppend]);
	expect(repository.appendUtterance).toHaveBeenCalledTimes(1);
});

it("resets capture identity, queues, and hydration ownership", async () => {
	const repository = createRepository();
	const captureSession = new NoteTranscriptCaptureSession();
	await captureSession.ensureSession(createStartArgs(repository));
	captureSession.recordUtterance(utterance);
	captureSession.markListeningStarted(100);
	captureSession.reset();

	expect(captureSession.activeTranscriptSessionId).toBeNull();
	expect(captureSession.completedTranscriptSessionId).toBeNull();
	expect(captureSession.currentUtterances).toEqual([]);
	expect(captureSession.listeningStartedAt).toBeNull();
});

it("terminalizes a stale start without clearing the replacement start", async () => {
	let resolveFirstStart: ((value: Id<"transcriptSessions">) => void) | null =
		null;
	let resolveSecondStart: ((value: Id<"transcriptSessions">) => void) | null =
		null;
	const replacementSessionId = "session-2" as Id<"transcriptSessions">;
	const repository = createRepository();
	repository.startSession
		.mockImplementationOnce(
			async () =>
				await new Promise<Id<"transcriptSessions">>((resolve) => {
					resolveFirstStart = resolve;
				}),
		)
		.mockImplementationOnce(
			async () =>
				await new Promise<Id<"transcriptSessions">>((resolve) => {
					resolveSecondStart = resolve;
				}),
		);
	const captureSession = new NoteTranscriptCaptureSession();
	const firstStart = captureSession.ensureSession(createStartArgs(repository));
	captureSession.reset();
	const replacementArgs = createStartArgs(repository);
	const secondStart = captureSession.ensureSession(replacementArgs);

	resolveFirstStart?.(sessionId);
	await expect(firstStart).resolves.toBe(sessionId);
	expect(repository.completeSession).toHaveBeenCalledWith({ sessionId });
	expect(captureSession.hasPendingStart).toBe(true);

	resolveSecondStart?.(replacementSessionId);
	await expect(secondStart).resolves.toBe(replacementSessionId);
	expect(captureSession.activeTranscriptSessionId).toBe(replacementSessionId);
});

it("keeps a restored draft until the server snapshot is newer or generated", () => {
	const captureSession = new NoteTranscriptCaptureSession();
	captureSession.beginDraftRestore();
	captureSession.restoreDraft({
		updatedAt: 200,
		utterances: [utterance],
	});
	captureSession.finishDraftRestore();
	const latestSession = {
		generatedNoteAt: null,
		sessionId,
		utterances: [utterance],
	};
	const hydrationInput = {
		isDraftReady: true,
		isSpeechListening: false,
		latestServerTranscript: "First thought",
		latestSession,
		latestSessionUpdatedAt: 100,
		pendingGenerateTranscript: "First thought",
		utteranceCount: 1,
	};

	expect(captureSession.shouldHydrateStoredSession(hydrationInput)).toBe(false);
	expect(
		captureSession.shouldHydrateStoredSession({
			...hydrationInput,
			latestSessionUpdatedAt: 201,
		}),
	).toBe(true);
	expect(
		captureSession.shouldHydrateStoredSession({
			...hydrationInput,
			latestSession: {
				...latestSession,
				generatedNoteAt: 300,
			},
		}),
	).toBe(true);
});
