import type { ChatLatencyLogger } from "@workspace/ai/chat-latency-logger";
import { prepareHostedChatContextWindow } from "@workspace/ai/hosted-chat-turn";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";

export const prepareServerChatContextWindow = async ({
	anchorMessageId,
	chatId,
	convexClient,
	logLatency,
	safetyIdentifier,
	workspaceId,
}: {
	anchorMessageId: string;
	chatId: string;
	convexClient: ConvexHttpClient;
	logLatency: ChatLatencyLogger;
	safetyIdentifier: string;
	workspaceId: Id<"workspaces">;
}) => {
	const activityId = crypto.randomUUID();
	const contextWindow = await prepareHostedChatContextWindow({
		compactionLifecycle: {
			start: () =>
				convexClient.mutation(api.chatContextCompactions.startActivity, {
					workspaceId,
					chatId,
					activityId,
					anchorMessageId,
				}),
			cancel: () =>
				convexClient.mutation(api.chatContextCompactions.cancelActivity, {
					workspaceId,
					chatId,
					activityId,
				}),
		},
		loadState: () =>
			convexClient.query(api.chatContextCompactions.getPreparationState, {
				workspaceId,
				chatId,
			}),
		safetyIdentifier,
		saveCompaction: (args) =>
			convexClient.mutation(api.chatContextCompactions.save, {
				workspaceId,
				chatId,
				activityId,
				...args,
			}),
	});
	logLatency("chat.context_prepared", {
		compactionCount: contextWindow.compactionCount,
		messageCount: contextWindow.messages.length,
	});
	return contextWindow;
};
