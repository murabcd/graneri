import type { FunctionReturnType } from "convex/server";
import * as React from "react";
import { getCachedConvexToken } from "@/lib/convex-token";
import { logError } from "@/lib/logger";
import type { QueuedChatSession } from "@/lib/queued-chat-session";
import type { api } from "../../../../convex/_generated/api";
import { useQueuedChatSession } from "./use-queued-chat-session";
import { useWorkspaceChatClient } from "./use-workspace-chat-client";

const startAutomaticQueuedReplay = (
	send: (
		isCanceled: () => boolean,
	) => Promise<Awaited<ReturnType<QueuedChatSession["send"]>>>,
) => {
	let canceled = false;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let failures = 0;
	const dispatch = async () => {
		const result = await send(() => canceled);
		if (canceled || result.status === "sent" || result.status === "canceled") {
			return;
		}
		if (result.status === "failed" && failures === 0) {
			logError({
				event: "client.error",
				error: result.error,
				message: "Automatic queued replay failed",
			});
		}
		failures += 1;
		retryTimer = setTimeout(
			() => {
				void dispatch();
			},
			Math.min(1000 * 2 ** (failures - 1), 30_000),
		);
	};
	void dispatch();
	return () => {
		canceled = true;
		clearTimeout(retryTimer);
	};
};

export const useAutomaticQueuedReplay = (
	head: NonNullable<
		FunctionReturnType<typeof api.assistantQueuedMessageDispatch.getHead>
	>,
	chatId: string,
) => {
	const { session } = useQueuedChatSession({
		scopeKey: `${head.workspaceId}:${chatId}`,
		activeRunId: null,
	});
	const { chat, latestRequestBodyRef } = useWorkspaceChatClient({
		workspaceId: head.workspaceId,
		chatId,
		onQueuedAcceptance: session.accept,
	});
	React.useEffect(
		() =>
			startAutomaticQueuedReplay((isCanceled) =>
				session.send(
					{ type: "replay", origin: "automatic", queuedMessage: head },
					{
						hasMessageId: () => false,
						resolveConvexToken: getCachedConvexToken,
						setLatestRequestBody: (body) => {
							latestRequestBodyRef.current = body;
						},
						steerMessageIds: [],
						sendMessage: async (message, options) => {
							if (isCanceled()) return;
							await chat.sendMessage(message, options);
							if (chat.error) throw chat.error;
						},
					},
				),
			),
		[chat, head, latestRequestBodyRef, session],
	);
};
