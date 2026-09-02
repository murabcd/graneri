import * as React from "react";
import type { BeginQueuedChatReplay } from "@/lib/queued-chat-intent";

type QueuedReplayStart = {
	lastObservedRunId: string | null;
	lifecycleVersion: number;
};

type QueuedReplayHandoff =
	| {
			lastObservedRunId: string | null;
			lifecycleVersion: number;
			phase: "awaiting_successor";
	  }
	| {
			lifecycleVersion: number;
			phase: "missing_start";
	  };

export type QueuedReplayAcceptanceResult =
	| "accepted"
	| "missing_start"
	| "stale";

type QueuedReplayLifecycle = {
	lastObservedRunId: string | null;
	scopeKey: string;
	version: number;
};

export const useQueuedReplayHandoff = ({
	activeRunId,
	scopeKey,
}: {
	activeRunId: string | null;
	scopeKey: string;
}) => {
	const lifecycleRef = React.useRef<QueuedReplayLifecycle>({
		lastObservedRunId: activeRunId,
		scopeKey,
		version: 0,
	});
	const replayStartsRef = React.useRef(new Map<string, QueuedReplayStart>());
	const [handoff, setHandoff] = React.useState<QueuedReplayHandoff | null>(
		null,
	);

	React.useLayoutEffect(() => {
		const lifecycle = lifecycleRef.current;
		const scopeChanged = lifecycle.scopeKey !== scopeKey;
		if (scopeChanged) {
			lifecycle.version += 1;
			lifecycle.scopeKey = scopeKey;
			lifecycle.lastObservedRunId = activeRunId;
			return;
		}
		// Acceptance can arrive after a fast successor has already completed, so
		// retain the last non-null run instead of replacing it with null.
		if (activeRunId !== null) {
			lifecycle.lastObservedRunId = activeRunId;
		}
	}, [activeRunId, scopeKey]);

	const invalidateReplay = React.useCallback(() => {
		lifecycleRef.current.version += 1;
	}, []);

	const beginReplay = React.useCallback<BeginQueuedChatReplay>(
		(queuedMessage) => {
			const replayStart = {
				lastObservedRunId: lifecycleRef.current.lastObservedRunId,
				lifecycleVersion: lifecycleRef.current.version,
			};
			replayStartsRef.current.set(queuedMessage._id, replayStart);

			return () => {
				if (replayStartsRef.current.get(queuedMessage._id) === replayStart) {
					replayStartsRef.current.delete(queuedMessage._id);
				}
			};
		},
		[],
	);

	const acceptReplay = React.useCallback(
		({
			queuedMessageId,
		}: {
			queuedMessageId: string;
		}): QueuedReplayAcceptanceResult => {
			const replayStart = replayStartsRef.current.get(queuedMessageId);
			if (!replayStart) {
				// Without the pre-send marker, draining again could duplicate accepted
				// input. Keep the queue fenced and surface the invariant upstream.
				setHandoff({
					lifecycleVersion: lifecycleRef.current.version,
					phase: "missing_start",
				});
				return "missing_start";
			}

			replayStartsRef.current.delete(queuedMessageId);
			const lifecycle = lifecycleRef.current;
			if (replayStart.lifecycleVersion !== lifecycle.version) {
				return "stale";
			}
			if (replayStart.lastObservedRunId !== lifecycle.lastObservedRunId) {
				setHandoff(null);
				return "accepted";
			}

			setHandoff({
				lastObservedRunId: replayStart.lastObservedRunId,
				lifecycleVersion: replayStart.lifecycleVersion,
				phase: "awaiting_successor",
			});
			return "accepted";
		},
		[],
	);

	const lifecycle = lifecycleRef.current;
	const lastObservedRunId = activeRunId ?? lifecycle.lastObservedRunId;
	const isPending =
		lifecycle.scopeKey === scopeKey &&
		handoff?.lifecycleVersion === lifecycle.version &&
		(handoff.phase === "missing_start" ||
			handoff.lastObservedRunId === lastObservedRunId);

	return { acceptReplay, beginReplay, invalidateReplay, isPending };
};
