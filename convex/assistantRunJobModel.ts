import { vWorkflowId } from "@convex-dev/workflow";
import { CHAT_MODE } from "@workspace/ai/chat-mode";
import { type Infer, v } from "convex/values";
import {
	pendingDecisionValidator,
	reasoningEffortValidator,
	serviceTierValidator,
} from "./assistantRunModel";

export const appToolScopeValidator = v.union(
	v.literal("disabled"),
	v.literal("available"),
	v.literal("selected"),
);

export type AppToolScope = Infer<typeof appToolScopeValidator>;

export const chatModeValidator = v.union(
	v.literal(CHAT_MODE.DEFAULT),
	v.literal(CHAT_MODE.PLAN),
);

export const assistantRunJobValidator = v.object({
	messagesJson: v.string(),
	instructions: v.string(),
	chatMode: chatModeValidator,
	webSearchEnabled: v.boolean(),
	appToolScope: appToolScopeValidator,
	shouldGenerateChatTitle: v.optional(v.boolean()),
	selectedSourceIds: v.array(v.string()),
	defaultTimezone: v.string(),
	model: v.string(),
	reasoningEffort: reasoningEffortValidator,
	serviceTier: serviceTierValidator,
});

export type AssistantRunJob = Infer<typeof assistantRunJobValidator>;

export const assistantRunStepOutcomeValidator = v.union(
	v.literal("continue"),
	v.literal("waiting_for_user"),
	v.literal("completed"),
);

export const assistantRunStepUsageValidator = v.object({
	inputTokens: v.number(),
	outputTokens: v.number(),
	totalTokens: v.number(),
});

export const assistantRunStepCheckpointValidator = v.object({
	stepIndex: v.number(),
	outcome: assistantRunStepOutcomeValidator,
	usage: assistantRunStepUsageValidator,
	pendingDecision: v.optional(pendingDecisionValidator),
});

export const assistantRunExecutionValidator = v.object({
	workflowId: v.optional(vWorkflowId),
	assistantMessageId: v.string(),
	completedStepCount: v.number(),
	usage: assistantRunStepUsageValidator,
	lastCheckpoint: v.optional(assistantRunStepCheckpointValidator),
});

export type AssistantRunStepOutcome = Infer<
	typeof assistantRunStepOutcomeValidator
>;
export type AssistantRunStepUsage = Infer<
	typeof assistantRunStepUsageValidator
>;
export type AssistantRunExecution = Infer<
	typeof assistantRunExecutionValidator
>;
