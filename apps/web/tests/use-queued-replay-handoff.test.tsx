import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	type QueuedReplayAcceptanceResult,
	useQueuedReplayHandoff,
} from "../src/hooks/use-queued-replay-handoff";

const queuedMessage = {
	_id: "queued-1" as Id<"assistantQueuedMessages">,
};

describe("useQueuedReplayHandoff", () => {
	it("releases an accepted replay after its successor run is observed", () => {
		let activeRunId: string | null = "run-1";
		const { result, rerender } = renderHook(() =>
			useQueuedReplayHandoff({ activeRunId, scopeKey: "chat-1" }),
		);

		activeRunId = null;
		rerender();
		let acceptanceResult: QueuedReplayAcceptanceResult | undefined;
		act(() => {
			result.current.beginReplay(queuedMessage);
			acceptanceResult = result.current.acceptReplay({
				queuedMessageId: queuedMessage._id,
			});
		});

		expect(acceptanceResult).toBe("accepted");
		expect(result.current.isPending).toBe(true);

		activeRunId = "run-2";
		rerender();
		expect(result.current.isPending).toBe(false);

		activeRunId = null;
		rerender();
		expect(result.current.isPending).toBe(false);
	});

	it("remembers a successor that appears before replay acceptance", () => {
		let activeRunId: string | null = "run-1";
		const { result, rerender } = renderHook(() =>
			useQueuedReplayHandoff({ activeRunId, scopeKey: "chat-1" }),
		);

		activeRunId = null;
		rerender();
		act(() => {
			result.current.beginReplay(queuedMessage);
		});
		activeRunId = "run-2";
		rerender();
		activeRunId = null;
		rerender();

		let acceptanceResult: QueuedReplayAcceptanceResult | undefined;
		act(() => {
			acceptanceResult = result.current.acceptReplay({
				queuedMessageId: queuedMessage._id,
			});
		});

		expect(acceptanceResult).toBe("accepted");
		expect(result.current.isPending).toBe(false);
	});

	it("ignores a replay accepted after its chat scope changed", () => {
		let scopeKey = "chat-1";
		const { result, rerender } = renderHook(() =>
			useQueuedReplayHandoff({ activeRunId: null, scopeKey }),
		);

		act(() => {
			result.current.beginReplay(queuedMessage);
		});
		scopeKey = "chat-2";
		rerender();

		let acceptanceResult: QueuedReplayAcceptanceResult | undefined;
		act(() => {
			acceptanceResult = result.current.acceptReplay({
				queuedMessageId: queuedMessage._id,
			});
		});

		expect(acceptanceResult).toBe("stale");
		expect(result.current.isPending).toBe(false);
	});

	it("fails closed when an accepted replay has no registered start", () => {
		const { result } = renderHook(() =>
			useQueuedReplayHandoff({
				activeRunId: null,
				scopeKey: "chat-1",
			}),
		);

		let acceptanceResult: QueuedReplayAcceptanceResult | undefined;
		act(() => {
			acceptanceResult = result.current.acceptReplay({
				queuedMessageId: queuedMessage._id,
			});
		});

		expect(acceptanceResult).toBe("missing_start");
		expect(result.current.isPending).toBe(true);
	});

	it("invalidates an accepted handoff after the request fails", () => {
		const { result, rerender } = renderHook(() =>
			useQueuedReplayHandoff({
				activeRunId: null,
				scopeKey: "chat-1",
			}),
		);

		act(() => {
			result.current.beginReplay(queuedMessage);
			result.current.acceptReplay({ queuedMessageId: queuedMessage._id });
		});
		expect(result.current.isPending).toBe(true);

		act(() => {
			result.current.invalidateReplay();
		});
		rerender();
		expect(result.current.isPending).toBe(false);
	});
});
