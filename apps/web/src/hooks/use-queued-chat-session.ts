import * as React from "react";
import {
	getQueuedChatSession,
	retainQueuedChatSession,
} from "@/lib/queued-chat-sessions";

export const useQueuedChatSession = ({
	activeRunId,
	scopeKey,
}: {
	activeRunId: string | null;
	scopeKey: string;
}) => {
	const session = React.useMemo(
		() => getQueuedChatSession(scopeKey),
		[scopeKey],
	);
	React.useLayoutEffect(() => retainQueuedChatSession(session), [session]);
	React.useLayoutEffect(() => {
		session.observeRun(activeRunId);
	}, [activeRunId, session]);
	const snapshot = React.useSyncExternalStore(
		session.subscribe,
		session.getSnapshot,
		session.getSnapshot,
	);
	return { session, snapshot };
};
