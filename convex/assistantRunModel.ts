import { v } from "convex/values";

export const reasoningEffortValidator = v.union(
	v.literal("low"),
	v.literal("medium"),
	v.literal("high"),
	v.literal("xhigh"),
);

export const assistantRunStatusValidator = v.union(
	v.literal("running"),
	v.literal("waiting_for_user"),
	v.literal("stopping"),
	v.literal("stopped"),
	v.literal("failed"),
	v.literal("completed"),
);

export const assistantRunProducerValidator = v.union(
	v.literal("web"),
	v.literal("convex"),
);

export const toolApprovalPendingDecisionValidator = v.object({
	type: v.literal("tool_approval"),
	approvalId: v.string(),
	assistantMessageId: v.string(),
	toolCallId: v.string(),
	toolName: v.string(),
});

export const userQuestionPendingDecisionValidator = v.object({
	type: v.literal("user_question"),
	assistantMessageId: v.string(),
	toolCallId: v.string(),
	question: v.string(),
});

export const pendingDecisionValidator = v.union(
	userQuestionPendingDecisionValidator,
	toolApprovalPendingDecisionValidator,
);

export const stopReasonValidator = v.union(
	v.literal("user_requested"),
	v.literal("superseded"),
	v.literal("cleanup_failed"),
);

export const assistantRunValidator = v.object({
	_id: v.id("assistantRuns"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	chatId: v.id("chats"),
	assistantMessageId: v.string(),
	producer: assistantRunProducerValidator,
	interruptedAssistantMessageIds: v.optional(v.array(v.string())),
	status: assistantRunStatusValidator,
	model: v.string(),
	reasoningEffort: v.optional(reasoningEffortValidator),
	phase: v.optional(v.string()),
	pendingDecision: v.optional(pendingDecisionValidator),
	stopReason: v.optional(stopReasonValidator),
	errorText: v.optional(v.string()),
	startedAt: v.number(),
	updatedAt: v.number(),
	finishedAt: v.optional(v.number()),
});
