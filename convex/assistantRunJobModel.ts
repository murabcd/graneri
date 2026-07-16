import { vWorkflowId } from "@convex-dev/workflow";
import { type Infer, v } from "convex/values";
import {
	pendingDecisionValidator,
	reasoningEffortValidator,
} from "./assistantRunModel";

export const assistantRunJobValidator = v.object({
	messagesJson: v.string(),
	systemPrompt: v.string(),
	webSearchEnabled: v.boolean(),
	chartGenerationRequested: v.boolean(),
	imageGenerationRequested: v.boolean(),
	shouldGenerateChatTitle: v.optional(v.boolean()),
	selectedSourceIds: v.array(v.string()),
	defaultTimezone: v.string(),
	model: v.string(),
	reasoningEffort: reasoningEffortValidator,
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
export type AssistantRunExecution = Infer<typeof assistantRunExecutionValidator>;
