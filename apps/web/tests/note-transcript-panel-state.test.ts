import { describe, expect, it, vi } from "vitest";
import { createNoteTranscriptPanelState } from "../src/components/note/note-transcript-panel-state";

const createState = (
	overrides: Partial<Parameters<typeof createNoteTranscriptPanelState>[0]> = {},
) =>
	createNoteTranscriptPanelState({
		hasMoreStoredTranscriptUtterances: false,
		hasTranscript: false,
		isListening: false,
		isLoadingMoreStoredTranscriptUtterances: false,
		isStoredTranscriptLoading: false,
		loadMoreStoredTranscriptUtterances: vi.fn(),
		...overrides,
	});

describe("createNoteTranscriptPanelState", () => {
	it("models loading and active empty transcript states", () => {
		expect(createState({ isStoredTranscriptLoading: true })).toEqual({
			status: "loading",
		});
		expect(
			createState({ isListening: true, isStoredTranscriptLoading: true }),
		).toEqual({ status: "empty", mode: "listening" });
	});

	it("models complete and loading pagination states", () => {
		expect(createState({ hasTranscript: true })).toEqual({
			status: "ready",
			mode: "paused",
			pagination: { status: "complete" },
		});

		const loadMore = vi.fn();
		expect(
			createState({
				hasMoreStoredTranscriptUtterances: true,
				hasTranscript: true,
				isLoadingMoreStoredTranscriptUtterances: true,
				loadMoreStoredTranscriptUtterances: loadMore,
			}),
		).toEqual({
			status: "ready",
			mode: "paused",
			pagination: { status: "loading", loadMore },
		});
	});
});
