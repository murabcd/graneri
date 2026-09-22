import { renderHook, waitFor } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	createScopedTranscriptState,
	syncActiveTranscriptSessionId,
} from "../src/hooks/note-transcript-session-state";

const sessionId = "session-1" as Id<"transcriptSessions">;

describe("active transcript session state", () => {
	it("stabilizes after a session starts even when the observer runs on each render", async () => {
		const initialState = createScopedTranscriptState({
			completeSession: async () => undefined,
			isSpeechListening: true,
			scopeKey: "note:recording",
		});
		let renderCount = 0;
		const { result } = renderHook(() => {
			const [state, setState] = React.useState(initialState);
			renderCount += 1;
			React.useEffect(() => {
				if (state.scopeKey !== "note:recording") {
					return;
				}
				setState((currentState) =>
					syncActiveTranscriptSessionId(currentState, sessionId),
				);
			}, [state]);
			return state;
		});
		await new Promise<void>((resolve) => {
			window.setTimeout(resolve, 25);
		});

		await waitFor(() =>
			expect(result.current.activeTranscriptSessionId).toBe(sessionId),
		);
		expect(renderCount).toBeLessThan(4);
		expect(syncActiveTranscriptSessionId(result.current, sessionId)).toBe(
			result.current,
		);
	});

	it("can return to no active session after a start-stop race", () => {
		const initialState = createScopedTranscriptState({
			completeSession: async () => undefined,
			isSpeechListening: true,
			scopeKey: "note:recording",
		});
		const capturingState = syncActiveTranscriptSessionId(
			initialState,
			sessionId,
		);

		expect(syncActiveTranscriptSessionId(capturingState, null)).toMatchObject({
			activeTranscriptSessionId: null,
			scopeKey: initialState.scopeKey,
		});
	});
});
