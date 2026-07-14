import type { ChatLatencyLogger } from "@workspace/ai/chat-latency-logger";
import { prepareHostedChatContextWindow } from "@workspace/ai/hosted-chat-turn";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";

export const prepareServerChatContextWindow = async ({
	chatId,
	convexClient,
	logLatency,
	safetyIdentifier,
	workspaceId,
}: {
	chatId: string;
	convexClient: ConvexHttpClient;
	logLatency: ChatLatencyLogger;
	safetyIdentifier: string;
	workspaceId: Id<"workspaces">;
}) => {
	const contextWindow = await prepareHostedChatContextWindow({
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
				...args,
			}),
	});
	logLatency("chat.context_prepared", {
		compactionCount: contextWindow.compactionCount,
		messageCount: contextWindow.messages.length,
	});
	return contextWindow.messages;
};
