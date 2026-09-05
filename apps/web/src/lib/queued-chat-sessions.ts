import {
	createQueuedChatSession,
	type QueuedChatSession,
} from "./queued-chat-session";

// Presentation and app dispatch share the same per-chat reservation. Entries
// live only while either consumer is mounted; unrelated chat scopes never share receipts.
const sessions = new Map<
	string,
	{ session: QueuedChatSession; consumers: number }
>();
export const getQueuedChatSession = (scopeKey: string) => {
	let entry = sessions.get(scopeKey);
	if (!entry) {
		entry = { session: createQueuedChatSession(scopeKey), consumers: 0 };
		sessions.set(scopeKey, entry);
	}
	return entry.session;
};
export const retainQueuedChatSession = (session: QueuedChatSession) => {
	const entry = sessions.get(session.scopeKey);
	if (!entry || entry.session !== session)
		throw new Error("Queued chat session ownership changed before commit.");
	entry.consumers += 1;
	const disconnect = session.connect();
	return () => {
		disconnect();
		entry.consumers -= 1;
		// Strict Mode reconnects before this cleanup; do not replace its owner.
		queueMicrotask(() => {
			if (entry.consumers === 0 && sessions.get(session.scopeKey) === entry)
				sessions.delete(session.scopeKey);
		});
	};
};
