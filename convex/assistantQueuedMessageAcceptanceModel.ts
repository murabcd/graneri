import type { Infer } from "convex/values";
import { v } from "convex/values";

export const assistantQueuedMessageAcceptanceKindValidator = v.union(
	v.literal("replay"),
	v.literal("steer"),
);

const assistantQueuedMessageAcceptanceIdentityFields = {
	kind: assistantQueuedMessageAcceptanceKindValidator,
	producer: v.union(v.literal("convex"), v.literal("web")),
	queuedMessageId: v.id("assistantQueuedMessages"),
	claimVersion: v.number(),
	messageId: v.string(),
	runId: v.id("assistantRuns"),
	assistantMessageId: v.string(),
};

export const assistantQueuedMessageAcceptanceTableValidator = v.object({
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	chatId: v.id("chats"),
	chatMessageId: v.id("chatMessages"),
	...assistantQueuedMessageAcceptanceIdentityFields,
	createdAt: v.number(),
});

export const assistantQueuedMessageAcceptanceReceiptValidator = v.object(
	assistantQueuedMessageAcceptanceIdentityFields,
);

export const assistantQueuedMessageAcceptanceStatusValidator = v.union(
	v.object({
		status: v.literal("accepted"),
		receipt: assistantQueuedMessageAcceptanceReceiptValidator,
	}),
	v.object({ status: v.literal("not_accepted") }),
);

export type AssistantQueuedMessageAcceptanceReceipt = Infer<
	typeof assistantQueuedMessageAcceptanceReceiptValidator
>;
