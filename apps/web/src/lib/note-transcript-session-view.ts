import {
	createEmptyLiveTranscriptState,
	createLiveTranscriptEntries,
	createTranscriptBlocksText,
	createTranscriptDisplayEntries,
	createTranscriptExportText,
	type LiveTranscriptState,
	type TranscriptUtterance,
} from "@/lib/transcript";

type StoredTranscriptSession = {
	utterances: TranscriptUtterance[];
};

type TranscriptSessionLanguage = {
	transcriptionLanguage: string | null;
};

const sortTranscriptUtterances = (
	utterances: TranscriptUtterance[],
): TranscriptUtterance[] =>
	utterances.slice().sort((left, right) => {
		if (left.startedAt !== right.startedAt) {
			return left.startedAt - right.startedAt;
		}

		if (left.endedAt !== right.endedAt) {
			return left.endedAt - right.endedAt;
		}

		return left.id.localeCompare(right.id);
	});

export const mergeTranscriptUtterances = (
	...utteranceGroups: TranscriptUtterance[][]
): TranscriptUtterance[] => {
	const utterancesById = new Map<string, TranscriptUtterance>();

	for (const utteranceGroup of utteranceGroups) {
		for (const utterance of utteranceGroup) {
			utterancesById.set(utterance.id, utterance);
		}
	}

	return sortTranscriptUtterances([...utterancesById.values()]);
};

export const resolveTranscriptSessionLanguage = ({
	fallbackLanguage = null,
	session,
	summary,
}: {
	fallbackLanguage?: string | null;
	session: TranscriptSessionLanguage | null | undefined;
	summary: TranscriptSessionLanguage | null | undefined;
}) => {
	if (session) {
		return session.transcriptionLanguage;
	}

	if (summary) {
		return summary.transcriptionLanguage;
	}

	return fallbackLanguage;
};

export const resolveTranscriptSessionReady = ({
	hasLocalCaptureTranscript,
	isDraftReady,
	isSummaryLoading,
	isViewingCaptureScope,
}: {
	hasLocalCaptureTranscript: boolean;
	isDraftReady: boolean;
	isSummaryLoading: boolean;
	isViewingCaptureScope: boolean;
}) =>
	isViewingCaptureScope
		? hasLocalCaptureTranscript || (isDraftReady && !isSummaryLoading)
		: !isSummaryLoading;

export const createVisibleTranscriptView = ({
	currentNoteLatestTranscriptSession,
	isViewingCaptureScope,
	listeningStartedAt,
	liveTranscript,
	orderedTranscriptUtterances,
}: {
	currentNoteLatestTranscriptSession:
		| StoredTranscriptSession
		| null
		| undefined;
	isViewingCaptureScope: boolean;
	listeningStartedAt: number | null;
	liveTranscript: LiveTranscriptState;
	orderedTranscriptUtterances: TranscriptUtterance[];
}) => {
	const visibleOrderedTranscriptUtterances = isViewingCaptureScope
		? orderedTranscriptUtterances
		: (currentNoteLatestTranscriptSession?.utterances ?? []);
	const visibleLiveTranscript = isViewingCaptureScope
		? liveTranscript
		: createEmptyLiveTranscriptState();
	const visibleLiveTranscriptEntries = createLiveTranscriptEntries(
		visibleLiveTranscript,
	);
	const visibleDisplayTranscriptEntries = createTranscriptDisplayEntries({
		liveTranscript: visibleLiveTranscript,
		utterances: visibleOrderedTranscriptUtterances,
	});
	const committedStartedAt =
		visibleOrderedTranscriptUtterances[0]?.startedAt ?? null;
	const liveStartedAt = visibleLiveTranscriptEntries.reduce<number | null>(
		(currentValue, entry) => {
			if (entry.startedAt == null) {
				return currentValue;
			}

			return currentValue == null
				? entry.startedAt
				: Math.min(currentValue, entry.startedAt);
		},
		null,
	);
	const visibleTranscriptStartedAt =
		committedStartedAt ??
		liveStartedAt ??
		(isViewingCaptureScope ? listeningStartedAt : null) ??
		null;

	return {
		visibleDisplayTranscriptEntries,
		visibleExportTranscript: createTranscriptExportText({
			entries: visibleDisplayTranscriptEntries,
			startedAt: visibleTranscriptStartedAt,
		}),
		visibleFullTranscript: createTranscriptBlocksText(
			visibleDisplayTranscriptEntries,
		),
		visibleLiveTranscript,
		visibleLiveTranscriptEntries,
		visibleOrderedTranscriptUtterances,
		visibleTranscriptStartedAt,
	};
};
