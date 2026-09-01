import type { Infer } from "convex/values";
import { v } from "convex/values";

const assistantQueuedMessageBaseValidator = v.object({
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	chatId: v.id("chats"),
	runId: v.id("assistantRuns"),
	messageId: v.string(),
	metadataJson: v.optional(v.string()),
	text: v.string(),
	requestBodyJson: v.string(),
	createdAt: v.number(),
	updatedAt: v.number(),
	claimVersion: v.number(),
});

const assistantQueuedMessageDocumentBaseValidator =
	assistantQueuedMessageBaseValidator.extend({
		_id: v.id("assistantQueuedMessages"),
		_creationTime: v.number(),
	});

const queuedAssistantMessageFields = {
	status: v.literal("queued"),
};

export const assistantQueuedMessagePauseReasonValidator = v.union(
	v.literal("failed"),
	v.literal("interrupted"),
);

const pausedAssistantMessageFields = {
	status: v.literal("paused"),
	pauseReason: assistantQueuedMessagePauseReasonValidator,
};

const claimedAssistantMessageFields = {
	status: v.literal("claimed"),
	claimedAt: v.number(),
	claimOrigin: v.union(
		v.object({ status: v.literal("queued") }),
		v.object({
			status: v.literal("paused"),
			pauseReason: assistantQueuedMessagePauseReasonValidator,
		}),
	),
};

export const assistantQueuedMessageTableValidator = v.union(
	assistantQueuedMessageBaseValidator.extend(queuedAssistantMessageFields),
	assistantQueuedMessageBaseValidator.extend(pausedAssistantMessageFields),
	assistantQueuedMessageBaseValidator.extend(claimedAssistantMessageFields),
);

export const queuedAssistantQueuedMessageValidator =
	assistantQueuedMessageDocumentBaseValidator.extend(
		queuedAssistantMessageFields,
	);
export const pausedAssistantQueuedMessageValidator =
	assistantQueuedMessageDocumentBaseValidator.extend(
		pausedAssistantMessageFields,
	);
export const claimedAssistantQueuedMessageValidator =
	assistantQueuedMessageDocumentBaseValidator.extend(
		claimedAssistantMessageFields,
	);
export const assistantQueuedMessageReplayClaimAttemptValidator = v.union(
	v.object({
		status: v.literal("claimed"),
		claimedMessage: claimedAssistantQueuedMessageValidator,
	}),
	v.object({ status: v.literal("active_run") }),
	v.object({ status: v.literal("unavailable") }),
);
export const visibleAssistantQueuedMessageValidator = v.union(
	queuedAssistantQueuedMessageValidator,
	pausedAssistantQueuedMessageValidator,
);
export const assistantQueuedMessageValidator = v.union(
	queuedAssistantQueuedMessageValidator,
	pausedAssistantQueuedMessageValidator,
	claimedAssistantQueuedMessageValidator,
);

export type ClaimedAssistantQueuedMessage = Infer<
	typeof claimedAssistantQueuedMessageValidator
>;
export type AssistantQueuedMessageReplayClaimAttempt = Infer<
	typeof assistantQueuedMessageReplayClaimAttemptValidator
>;
export type AssistantQueuedMessagePauseReason = Infer<
	typeof assistantQueuedMessagePauseReasonValidator
>;
export type VisibleAssistantQueuedMessage = Infer<
	typeof visibleAssistantQueuedMessageValidator
>;
