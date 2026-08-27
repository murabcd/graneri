import { v } from "convex/values";

export const assistantRunPlanStepStatusValidator = v.union(
	v.literal("pending"),
	v.literal("in_progress"),
	v.literal("completed"),
);

export const assistantRunPlanStepValidator = v.object({
	step: v.string(),
	status: assistantRunPlanStepStatusValidator,
});

export const assistantRunPlanValidator = v.array(
	assistantRunPlanStepValidator,
);

export const assistantRunActivityValidator = v.object({
	_id: v.id("assistantRunActivities"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	chatId: v.id("chats"),
	runId: v.id("assistantRuns"),
	plan: assistantRunPlanValidator,
	updatedAt: v.number(),
});
