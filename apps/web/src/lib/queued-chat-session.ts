import type { QueuedFollowUpMessage } from "./chat-queued-followups";
import type { ChatRequestContext } from "./chat-request-preparation";
import { logError } from "./logger";
import {
	prepareQueuedReplayIntent,
	prepareQueuedSteerIntent,
	type QueuedChatSendMessage,
} from "./queued-chat-intent";

export type QueuedChatAcceptance = {
	queuedMessageId: string;
	type: "replay" | "steer";
};

export type QueuedChatSendIntent =
	| {
			type: "replay";
			origin: "automatic";
			queuedMessage: Extract<QueuedFollowUpMessage, { status: "queued" }>;
	  }
	| {
			type: "replay";
			origin: "manual";
			queuedMessage: QueuedFollowUpMessage;
	  }
	| {
			type: "steer";
			origin: "automatic" | "manual";
			queuedMessage: QueuedFollowUpMessage;
			runId: QueuedFollowUpMessage["runId"];
	  };

type SendEnvironment = {
	hasMessageId: (messageId: string) => boolean;
	resolveConvexToken: () => Promise<string | null>;
	sendMessage: QueuedChatSendMessage;
	setLatestRequestBody: (body: ChatRequestContext) => void;
	steerMessageIds: readonly string[];
};

type SendResult =
	| { status: "sent" | "busy" | "canceled" | "retry" }
	| { status: "failed"; error: unknown; accepted: boolean };

type SendOperation = {
	accepted: boolean;
	predecessor: string | null;
	replayVersion: number;
};

type QueueSnapshot = {
	acceptedIds: ReadonlySet<string>;
	isReplayPending: boolean;
	sending: { id: string; type: "automatic_replay" | "row_action" } | null;
	steerMessageIds: ReadonlySet<string>;
};

// One instance coordinates all mounted consumers of a chat scope. Requests retain this owner,
// so a late receipt cannot mutate the next chat's lifecycle.
export const createQueuedChatSession = (scopeKey: string) => {
	let connected = true;
	let connections = 0;
	let lastObservedRunId: string | null = null;
	let replayVersion = 0;
	let pendingSend: SendOperation | null = null;
	let replayHandoff:
		| { phase: "awaiting_successor"; predecessor: string | null }
		| { phase: "missing_start" }
		| null = null;
	const operations = new Map<string, SendOperation>();
	const listeners = new Set<() => void>();
	let snapshot: QueueSnapshot = {
		acceptedIds: new Set(),
		isReplayPending: false,
		sending: null,
		steerMessageIds: new Set(),
	};
	const publish = (change: Partial<QueueSnapshot>) => {
		snapshot = { ...snapshot, ...change };
		for (const listener of listeners) listener();
	};
	const releaseSend = (operation: SendOperation) => {
		if (pendingSend !== operation) return;
		pendingSend = null;
		publish({ sending: null });
	};

	return {
		scopeKey,
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		connect: () => {
			connections += 1;
			connected = true;
			return () => {
				connections -= 1;
				if (connections > 0) return;
				connected = false;
				operations.clear();
				pendingSend = null;
				replayHandoff = null;
				replayVersion += 1;
				publish({ sending: null, isReplayPending: false });
			};
		},
		observeRun: (runId: string | null) => {
			if (runId === null) return;
			lastObservedRunId = runId;
			if (
				replayHandoff?.phase === "awaiting_successor" &&
				replayHandoff.predecessor !== runId
			) {
				replayHandoff = null;
				publish({ isReplayPending: false });
			}
		},
		invalidateReplay: () => {
			replayVersion += 1;
			replayHandoff = null;
			if (snapshot.isReplayPending) publish({ isReplayPending: false });
		},
		reconcileAccepted: (messages: QueuedFollowUpMessage[]) => {
			const remaining = new Set<string>(messages.map((message) => message._id));
			const acceptedIds = new Set(
				[...snapshot.acceptedIds].filter((id) => remaining.has(id)),
			);
			if (acceptedIds.size !== snapshot.acceptedIds.size)
				publish({ acceptedIds });
		},
		accept: ({ queuedMessageId, type }: QueuedChatAcceptance) => {
			if (!connected) return;
			const operation = operations.get(queuedMessageId);
			if (type === "replay") {
				if (operation && operation.replayVersion !== replayVersion) return;
				if (!operation) {
					replayHandoff = { phase: "missing_start" };
					logError({
						event: "client.error",
						error: new Error("Queued replay start is missing."),
						message: "Queued replay handoff invariant failed",
					});
				} else {
					replayHandoff =
						operation.predecessor === lastObservedRunId
							? {
									phase: "awaiting_successor",
									predecessor: operation.predecessor,
								}
							: null;
				}
			}
			if (operation) {
				operation.accepted = true;
			}
			const releasesSend = operation !== undefined && pendingSend === operation;
			if (releasesSend) pendingSend = null;
			publish({
				acceptedIds: new Set([...snapshot.acceptedIds, queuedMessageId]),
				isReplayPending: replayHandoff !== null,
				sending: releasesSend ? null : snapshot.sending,
			});
		},
		send: async (
			intent: QueuedChatSendIntent,
			environment: SendEnvironment,
		): Promise<SendResult> => {
			if (!connected) return { status: "canceled" };
			if (pendingSend) return { status: "busy" };
			const operation: SendOperation = {
				accepted: false,
				predecessor: lastObservedRunId,
				replayVersion,
			};
			const id = intent.queuedMessage._id;
			pendingSend = operation;
			operations.set(id, operation);
			publish({
				sending: {
					id,
					type:
						intent.type === "replay" && intent.origin === "automatic"
							? "automatic_replay"
							: "row_action",
				},
			});
			let steerStarted = false;
			try {
				const token = await environment.resolveConvexToken();
				if (!connected || operations.get(id) !== operation)
					return { status: "canceled" };
				if (!token && intent.type === "replay" && intent.origin === "automatic")
					return { status: "retry" };
				const prepare = {
					hasMessageId: environment.hasMessageId,
					resolveConvexToken: async () => token,
				};
				const prepared =
					intent.type === "steer"
						? await prepareQueuedSteerIntent({
								...prepare,
								queuedMessage: intent.queuedMessage,
								activeRunId: intent.runId,
							})
						: await prepareQueuedReplayIntent({ ...prepare, ...intent });
				if (!connected || operations.get(id) !== operation)
					return { status: "canceled" };
				environment.setLatestRequestBody(prepared.body);
				// Capture immediately before sending, not before asynchronous preparation.
				operation.predecessor = lastObservedRunId;
				operation.replayVersion = replayVersion;
				if (intent.type === "steer") {
					steerStarted = true;
					publish({
						steerMessageIds: new Set([
							...snapshot.steerMessageIds,
							...environment.steerMessageIds,
						]),
					});
				}
				await environment.sendMessage(prepared.message, {
					body: prepared.body,
				});
				return { status: "sent" };
			} catch (error) {
				if (!operation.accepted && steerStarted) {
					const steerMessageIds = new Set(snapshot.steerMessageIds);
					for (const messageId of environment.steerMessageIds)
						steerMessageIds.delete(messageId);
					publish({ steerMessageIds });
				}
				return { status: "failed", error, accepted: operation.accepted };
			} finally {
				if (operations.get(id) === operation) operations.delete(id);
				releaseSend(operation);
			}
		},
	};
};

export type QueuedChatSession = ReturnType<typeof createQueuedChatSession>;
