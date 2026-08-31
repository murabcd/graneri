import {
	useConvex,
	useMutation,
	usePaginatedQuery,
	useQuery,
} from "convex/react";
import * as React from "react";
import type {
	LiveTranscriptState,
	SystemAudioCaptureSourceMode,
	TranscriptUtterance,
} from "@/lib/transcript";
import {
	clearTranscriptDraft,
	loadTranscriptDraft,
	saveTranscriptDraft,
} from "@/lib/transcript-draft";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

const TRANSCRIPT_UTTERANCE_PAGE_SIZE = 50;

type TranscriptDraftRecord = Awaited<ReturnType<typeof loadTranscriptDraft>>;
type TranscriptSessionStatus = Doc<"transcriptSessionStates">["status"];
type TranscriptRefinementStatus =
	Doc<"transcriptSessionStates">["refinementStatus"];

type TranscriptSessionSnapshot = {
	generatedNoteAt: number | null;
	hasTranscript: boolean;
	refinementError: string | null;
	refinementStatus: TranscriptRefinementStatus;
	sessionId: Id<"transcriptSessions">;
	status: TranscriptSessionStatus;
	transcriptionLanguage: string | null;
	updatedAt: number;
	utteranceCount: number;
	utterances: TranscriptUtterance[];
};

type TranscriptSessionSummary = Omit<TranscriptSessionSnapshot, "utterances">;

export type TranscriptSessionRepository = ReturnType<
	typeof useTranscriptSessionRepository
>;

const toTranscriptUtteranceInput = (
	utterance: TranscriptUtterance,
	source: "live" | "refined",
) => ({
	utteranceId: utterance.id,
	speaker: utterance.speaker,
	source,
	text: utterance.text,
	startedAt: utterance.startedAt,
	endedAt: utterance.endedAt,
});

export const useTranscriptSessionRepository = (
	noteId: Id<"notes"> | null,
	{
		shouldAutoLoadLatestTranscriptSession = true,
	}: {
		shouldAutoLoadLatestTranscriptSession?: boolean;
	} = {},
) => {
	const convex = useConvex();
	const startTranscriptSessionMutation = useMutation(
		api.transcriptSessions.startSession,
	);
	const requestStopTranscriptSessionMutation = useMutation(
		api.transcriptSessions.requestStopSession,
	);
	const appendTranscriptUtteranceMutation = useMutation(
		api.transcriptSessions.appendUtterance,
	);
	const completeTranscriptSessionMutation = useMutation(
		api.transcriptSessions.completeSession,
	);
	const setTranscriptSessionSystemAudioSourceModeMutation = useMutation(
		api.transcriptSessions.setSystemAudioSourceMode,
	);
	const markTranscriptSessionGeneratedMutation = useMutation(
		api.transcriptSessions.markGenerated,
	);
	const latestTranscriptSessionSummaryQuery = useQuery(
		api.transcriptSessions.getLatestSummaryForNote,
		noteId ? { noteId } : "skip",
	);
	const transcriptUtterancePagination = usePaginatedQuery(
		api.transcriptSessions.listUtterances,
		noteId &&
			shouldAutoLoadLatestTranscriptSession &&
			latestTranscriptSessionSummaryQuery
			? { sessionId: latestTranscriptSessionSummaryQuery._id }
			: "skip",
		{ initialNumItems: TRANSCRIPT_UTTERANCE_PAGE_SIZE },
	);
	const latestTranscriptSessionSummary =
		React.useMemo<TranscriptSessionSummary | null>(
			() =>
				latestTranscriptSessionSummaryQuery
					? {
							sessionId: latestTranscriptSessionSummaryQuery._id,
							generatedNoteAt:
								latestTranscriptSessionSummaryQuery.generatedNoteAt ?? null,
							hasTranscript: latestTranscriptSessionSummaryQuery.hasTranscript,
							refinementError:
								latestTranscriptSessionSummaryQuery.refinementError ?? null,
							refinementStatus:
								latestTranscriptSessionSummaryQuery.refinementStatus,
							status: latestTranscriptSessionSummaryQuery.status,
							transcriptionLanguage:
								latestTranscriptSessionSummaryQuery.transcriptionLanguage,
							updatedAt: latestTranscriptSessionSummaryQuery.updatedAt,
							utteranceCount:
								latestTranscriptSessionSummaryQuery.utteranceCount,
						}
					: null,
			[latestTranscriptSessionSummaryQuery],
		);
	const shouldDrainActiveTranscript = Boolean(
		latestTranscriptSessionSummary &&
			(latestTranscriptSessionSummary.status === "capturing" ||
				latestTranscriptSessionSummary.status === "stopping"),
	);

	React.useEffect(() => {
		if (
			shouldAutoLoadLatestTranscriptSession &&
			shouldDrainActiveTranscript &&
			transcriptUtterancePagination.status === "CanLoadMore"
		) {
			transcriptUtterancePagination.loadMore(TRANSCRIPT_UTTERANCE_PAGE_SIZE);
		}
	}, [
		shouldAutoLoadLatestTranscriptSession,
		shouldDrainActiveTranscript,
		transcriptUtterancePagination,
	]);

	const isLatestTranscriptSessionSummaryLoading = Boolean(
		noteId && latestTranscriptSessionSummaryQuery === undefined,
	);
	const isWaitingForTranscriptUtterances = Boolean(
		noteId &&
			shouldAutoLoadLatestTranscriptSession &&
			latestTranscriptSessionSummary &&
			(transcriptUtterancePagination.status === "LoadingFirstPage" ||
				(shouldDrainActiveTranscript &&
					transcriptUtterancePagination.status !== "Exhausted")),
	);
	const latestTranscriptSession = React.useMemo<
		TranscriptSessionSnapshot | null | undefined
	>(() => {
		if (!noteId || latestTranscriptSessionSummaryQuery === null) {
			return null;
		}
		if (
			latestTranscriptSessionSummaryQuery === undefined ||
			!shouldAutoLoadLatestTranscriptSession ||
			isWaitingForTranscriptUtterances ||
			!latestTranscriptSessionSummary
		) {
			return undefined;
		}

		return {
			...latestTranscriptSessionSummary,
			utterances: transcriptUtterancePagination.results.map((utterance) => ({
				id: utterance.utteranceId,
				speaker: utterance.speaker,
				text: utterance.text,
				startedAt: utterance.startedAt,
				endedAt: utterance.endedAt,
			})),
		};
	}, [
		isWaitingForTranscriptUtterances,
		latestTranscriptSessionSummary,
		latestTranscriptSessionSummaryQuery,
		noteId,
		shouldAutoLoadLatestTranscriptSession,
		transcriptUtterancePagination.results,
	]);
	const hasMoreLatestTranscriptUtterances =
		transcriptUtterancePagination.status === "CanLoadMore" ||
		transcriptUtterancePagination.status === "LoadingMore";
	const isLoadingMoreLatestTranscriptUtterances =
		transcriptUtterancePagination.status === "LoadingMore";
	const loadMoreLatestTranscriptUtterances = React.useCallback(() => {
		if (transcriptUtterancePagination.status === "CanLoadMore") {
			transcriptUtterancePagination.loadMore(TRANSCRIPT_UTTERANCE_PAGE_SIZE);
		}
	}, [transcriptUtterancePagination]);
	const getLatestTranscriptText = React.useCallback(
		async () =>
			noteId
				? await convex.query(api.transcriptSessions.getLatestTextForNote, {
						noteId,
					})
				: null,
		[convex, noteId],
	);
	const startSession = React.useCallback(
		async ({
			noteId,
			systemAudioSourceMode,
			transcriptionLanguage,
		}: {
			noteId: Id<"notes">;
			systemAudioSourceMode?: SystemAudioCaptureSourceMode;
			transcriptionLanguage: string | null;
		}) =>
			await startTranscriptSessionMutation({
				noteId,
				systemAudioSourceMode,
				transcriptionLanguage,
			}),
		[startTranscriptSessionMutation],
	);
	const appendUtterance = React.useCallback(
		async ({
			sessionId,
			source,
			utterance,
		}: {
			sessionId: Id<"transcriptSessions">;
			source: "live" | "refined";
			utterance: TranscriptUtterance;
		}) =>
			await appendTranscriptUtteranceMutation({
				sessionId,
				utterance: toTranscriptUtteranceInput(utterance, source),
			}),
		[appendTranscriptUtteranceMutation],
	);
	const completeSession = React.useCallback(
		async ({
			sessionId,
			status,
		}: {
			sessionId: Id<"transcriptSessions">;
			status?: "completed" | "failed";
		}) =>
			await completeTranscriptSessionMutation({
				sessionId,
				status,
			}),
		[completeTranscriptSessionMutation],
	);
	const requestStopSession = React.useCallback(
		async ({ sessionId }: { sessionId: Id<"transcriptSessions"> }) =>
			await requestStopTranscriptSessionMutation({ sessionId }),
		[requestStopTranscriptSessionMutation],
	);
	const setSystemAudioSourceMode = React.useCallback(
		async ({
			sessionId,
			systemAudioSourceMode,
		}: {
			sessionId: Id<"transcriptSessions">;
			systemAudioSourceMode: SystemAudioCaptureSourceMode;
		}) =>
			await setTranscriptSessionSystemAudioSourceModeMutation({
				sessionId,
				systemAudioSourceMode,
			}),
		[setTranscriptSessionSystemAudioSourceModeMutation],
	);
	const markGenerated = React.useCallback(
		async ({ sessionId }: { sessionId: Id<"transcriptSessions"> }) =>
			await markTranscriptSessionGeneratedMutation({ sessionId }),
		[markTranscriptSessionGeneratedMutation],
	);
	const loadDraft = React.useCallback(
		async (noteKey: string): Promise<TranscriptDraftRecord> =>
			await loadTranscriptDraft(noteKey),
		[],
	);
	const saveDraft = React.useCallback(
		async ({
			liveTranscript,
			noteKey,
			pendingGenerateTranscript,
			utterances,
		}: {
			liveTranscript: LiveTranscriptState;
			noteKey: string;
			pendingGenerateTranscript: string;
			utterances: TranscriptUtterance[];
		}) =>
			await saveTranscriptDraft({
				noteKey,
				utterances,
				liveTranscript,
				pendingGenerateTranscript,
			}),
		[],
	);
	const clearDraft = React.useCallback(
		async (noteKey: string) => await clearTranscriptDraft(noteKey),
		[],
	);

	return React.useMemo(
		() => ({
			appendUtterance,
			clearDraft,
			completeSession,
			getLatestTranscriptText,
			hasMoreLatestTranscriptUtterances,
			isLatestTranscriptSessionLoading:
				shouldAutoLoadLatestTranscriptSession &&
				(isLatestTranscriptSessionSummaryLoading ||
					isWaitingForTranscriptUtterances),
			isLatestTranscriptSessionSummaryLoading,
			isLoadingMoreLatestTranscriptUtterances,
			latestTranscriptSession,
			latestTranscriptSessionSummary,
			loadDraft,
			loadMoreLatestTranscriptUtterances,
			markGenerated,
			requestStopSession,
			saveDraft,
			setSystemAudioSourceMode,
			startSession,
		}),
		[
			appendUtterance,
			clearDraft,
			completeSession,
			getLatestTranscriptText,
			hasMoreLatestTranscriptUtterances,
			isLatestTranscriptSessionSummaryLoading,
			isLoadingMoreLatestTranscriptUtterances,
			isWaitingForTranscriptUtterances,
			latestTranscriptSession,
			latestTranscriptSessionSummary,
			loadDraft,
			loadMoreLatestTranscriptUtterances,
			markGenerated,
			requestStopSession,
			saveDraft,
			setSystemAudioSourceMode,
			shouldAutoLoadLatestTranscriptSession,
			startSession,
		],
	);
};
