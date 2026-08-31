import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useTranscriptSessionRepository } from "../src/hooks/use-transcript-session-repository";

const { convexQueryMock, loadMoreMock, usePaginatedQueryMock, useQueryMock } =
	vi.hoisted(() => ({
		convexQueryMock: vi.fn(),
		loadMoreMock: vi.fn(),
		usePaginatedQueryMock: vi.fn(),
		useQueryMock: vi.fn(),
	}));

vi.mock("convex/react", () => ({
	useConvex: () => ({ query: convexQueryMock }),
	useMutation: () => vi.fn(),
	usePaginatedQuery: usePaginatedQueryMock,
	useQuery: useQueryMock,
}));

const noteId = "note-1" as Id<"notes">;
const sessionId = "session-1" as Id<"transcriptSessions">;
const summary = {
	_id: sessionId,
	_creationTime: 1_000,
	ownerTokenIdentifier: "owner",
	noteId,
	transcriptionLanguage: "en",
	startedAt: 1_000,
	createdAt: 1_000,
	status: "completed" as const,
	refinementStatus: "completed" as const,
	generatedNoteAt: undefined,
	hasTranscript: true,
	utteranceCount: 75,
	updatedAt: 2_000,
};
const firstUtterance = {
	_id: "utterance-row-1" as Id<"transcriptUtterances">,
	_creationTime: 1_000,
	sessionId,
	ownerTokenIdentifier: "owner",
	noteId,
	utteranceId: "utterance-1",
	speaker: "you" as const,
	source: "live" as const,
	text: "First page",
	startedAt: 1_000,
	endedAt: 1_500,
	createdAt: 1_000,
	updatedAt: 1_000,
};

describe("useTranscriptSessionRepository", () => {
	beforeEach(() => {
		useQueryMock.mockReturnValue(summary);
		usePaginatedQueryMock.mockReturnValue({
			results: [firstUtterance],
			status: "CanLoadMore",
			loadMore: loadMoreMock,
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("keeps completed transcript history paginated", () => {
		const { result } = renderHook(() => useTranscriptSessionRepository(noteId));

		expect(result.current.latestTranscriptSessionSummary).toMatchObject({
			hasTranscript: true,
			sessionId,
			utteranceCount: 75,
		});
		expect(result.current.latestTranscriptSession?.utterances).toEqual([
			{
				id: "utterance-1",
				speaker: "you",
				text: "First page",
				startedAt: 1_000,
				endedAt: 1_500,
			},
		]);
		expect(result.current.hasMoreLatestTranscriptUtterances).toBe(true);

		act(() => result.current.loadMoreLatestTranscriptUtterances());
		expect(loadMoreMock).toHaveBeenCalledWith(50);
	});

	it("drains active recovery pages before publishing a partial snapshot", async () => {
		useQueryMock.mockReturnValue({ ...summary, status: "capturing" });
		const { result } = renderHook(() => useTranscriptSessionRepository(noteId));

		expect(result.current.latestTranscriptSession).toBeUndefined();
		expect(result.current.isLatestTranscriptSessionLoading).toBe(true);
		await waitFor(() => expect(loadMoreMock).toHaveBeenCalledWith(50));
	});
});
