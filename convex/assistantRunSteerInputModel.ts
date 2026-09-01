import { v } from "convex/values";

export const assistantRunSteerInputTableValidator = v.object({
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	chatId: v.id("chats"),
	runId: v.id("assistantRuns"),
	assistantMessageId: v.string(),
	queuedMessageId: v.id("assistantQueuedMessages"),
	claimVersion: v.number(),
	chatMessageId: v.id("chatMessages"),
	messageId: v.string(),
	createdAt: v.number(),
});
