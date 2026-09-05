import type { Infer } from "convex/values";
import { v } from "convex/values";

export const queuedMessageInputValidator = v.object({
	messageId: v.string(),
	metadataJson: v.optional(v.string()),
	text: v.string(),
	filesJson: v.string(),
	requestBodyJson: v.string(),
});
export type QueuedMessageInput = Infer<typeof queuedMessageInputValidator>;

const assistantQueuedMessageBaseValidator = queuedMessageInputValidator.extend({
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	chatId: v.id("chats"),
	runId: v.id("assistantRuns"),
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

const visibleAssistantMessageStateValidator = v.union(
	v.object(queuedAssistantMessageFields),
	v.object(pausedAssistantMessageFields),
);
const claimedAssistantMessageFields = {
	status: v.literal("claimed"),
	claimedAt: v.number(),
	claimOrigin: visibleAssistantMessageStateValidator,
};
const editingAssistantMessageFields = {
	status: v.literal("editing"),
	editOrigin: visibleAssistantMessageStateValidator,
};

export const assistantQueuedMessageTableValidator = v.union(
	assistantQueuedMessageBaseValidator.extend(queuedAssistantMessageFields),
	assistantQueuedMessageBaseValidator.extend(pausedAssistantMessageFields),
	assistantQueuedMessageBaseValidator.extend(claimedAssistantMessageFields),
	assistantQueuedMessageBaseValidator.extend(editingAssistantMessageFields),
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
export const editingAssistantQueuedMessageValidator =
	assistantQueuedMessageDocumentBaseValidator.extend(
		editingAssistantMessageFields,
	);
export const restoreEditingMessage = (
	message: Infer<typeof editingAssistantQueuedMessageValidator>,
) => {
	const { status, editOrigin, ...base } = message;
	return { ...base, ...editOrigin };
};
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
	editingAssistantQueuedMessageValidator,
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
