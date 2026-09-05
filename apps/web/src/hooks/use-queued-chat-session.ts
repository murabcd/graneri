import * as React from "react";
import { createQueuedChatSession } from "@/lib/queued-chat-session";

export const useQueuedChatSession = ({
	activeRunId,
	scopeKey,
}: {
	activeRunId: string | null;
	scopeKey: string;
}) => {
	const session = React.useMemo(
		() => createQueuedChatSession(scopeKey),
		[scopeKey],
	);
	React.useLayoutEffect(() => session.connect(), [session]);
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
