import type { Infer } from "convex/values";
import { v } from "convex/values";

export const reasoningEffortValidator = v.union(
	v.literal("low"),
	v.literal("medium"),
	v.literal("high"),
	v.literal("xhigh"),
);

export const serviceTierValidator = v.union(
	v.literal("auto"),
	v.literal("priority"),
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

export const toolApprovalAuthorityValidator = v.object({
	access: v.union(v.literal("read"), v.literal("write")),
	approval: v.union(v.literal("not_required"), v.literal("required")),
	provider: v.string(),
});

export const userQuestionOptionValidator = v.object({
	label: v.string(),
	description: v.optional(v.string()),
});

export const toolApprovalPendingDecisionValidator = v.object({
	type: v.literal("tool_approval"),
	approvalId: v.string(),
	assistantMessageId: v.string(),
	toolCallId: v.string(),
	toolName: v.string(),
	authority: v.optional(toolApprovalAuthorityValidator),
	consequence: v.string(),
});

export const userQuestionPendingDecisionValidator = v.object({
	type: v.literal("user_question"),
	assistantMessageId: v.string(),
	toolCallId: v.string(),
	question: v.string(),
	responseType: v.union(v.literal("text"), v.literal("choice")),
	options: v.optional(v.array(userQuestionOptionValidator)),
	consequence: v.optional(v.string()),
});

export const pendingDecisionValidator = v.union(
	userQuestionPendingDecisionValidator,
	toolApprovalPendingDecisionValidator,
);

export type AssistantRunPendingDecision = Infer<
	typeof pendingDecisionValidator
>;

export const humanDecisionResolutionValidator = v.union(
	v.object({
		type: v.literal("tool_approval"),
		approved: v.boolean(),
		toolCallId: v.string(),
	}),
	v.object({
		type: v.literal("user_question"),
		answerMessageIds: v.array(v.string()),
	}),
);

export type HumanDecisionResolution = Infer<
	typeof humanDecisionResolutionValidator
>;

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
	serviceTier: serviceTierValidator,
	phase: v.optional(v.string()),
	pendingDecision: v.optional(pendingDecisionValidator),
	stopReason: v.optional(stopReasonValidator),
	errorText: v.optional(v.string()),
	startedAt: v.number(),
	updatedAt: v.number(),
	finishedAt: v.optional(v.number()),
});
