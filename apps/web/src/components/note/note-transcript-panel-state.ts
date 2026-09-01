export type NoteTranscriptPanelState =
	| { status: "loading" }
	| { status: "empty"; mode: "listening" | "paused" }
	| {
			status: "ready";
			mode: "listening" | "paused";
			pagination:
				| { status: "complete" }
				| {
						status: "idle" | "loading";
						loadMore: () => void;
				  };
	  };

export function createNoteTranscriptPanelState({
	hasMoreStoredTranscriptUtterances,
	hasTranscript,
	isListening,
	isLoadingMoreStoredTranscriptUtterances,
	isStoredTranscriptLoading,
	loadMoreStoredTranscriptUtterances,
}: {
	hasMoreStoredTranscriptUtterances: boolean;
	hasTranscript: boolean;
	isListening: boolean;
	isLoadingMoreStoredTranscriptUtterances: boolean;
	isStoredTranscriptLoading: boolean;
	loadMoreStoredTranscriptUtterances: () => void;
}): NoteTranscriptPanelState {
	const mode = isListening ? "listening" : "paused";

	if (!hasTranscript) {
		return isStoredTranscriptLoading && !isListening
			? { status: "loading" }
			: { status: "empty", mode };
	}

	if (!hasMoreStoredTranscriptUtterances) {
		return {
			status: "ready",
			mode,
			pagination: { status: "complete" },
		};
	}

	return {
		status: "ready",
		mode,
		pagination: {
			status: isLoadingMoreStoredTranscriptUtterances ? "loading" : "idle",
			loadMore: loadMoreStoredTranscriptUtterances,
		},
	};
}
