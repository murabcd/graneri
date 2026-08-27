import { tool } from "ai";
import { z } from "zod";

export const HOSTED_RUN_ACTIVITY_TOOL_NAME = "update_plan";

const runPlanStepSchema = z.object({
	step: z.string().trim().min(1).max(160),
	status: z.enum(["pending", "in_progress", "completed"]),
});

export const hostedRunPlanSchema = z
	.array(runPlanStepSchema)
	.min(2)
	.max(12)
	.superRefine((plan, context) => {
		if (new Set(plan.map(({ step }) => step)).size !== plan.length) {
			context.addIssue({
				code: "custom",
				message: "Plan steps must be unique.",
			});
		}
		const activeStepCount = plan.filter(
			({ status }) => status === "in_progress",
		).length;
		const allCompleted = plan.every(({ status }) => status === "completed");
		if ((!allCompleted && activeStepCount !== 1) || activeStepCount > 1) {
			context.addIssue({
				code: "custom",
				message:
					"A plan must have exactly one active step unless every step is completed.",
			});
		}

		const statusRank = { completed: 0, in_progress: 1, pending: 2 };
		let previousRank = 0;
		for (const { status } of plan) {
			const rank = statusRank[status];
			if (rank < previousRank) {
				context.addIssue({
					code: "custom",
					message:
						"Plan steps must be ordered as completed, active, then pending.",
				});
				break;
			}
			previousRank = rank;
		}
	});

export const createHostedRunActivityTool = ({ publishPlan }) =>
	tool({
		description:
			"Publish and maintain a short user-visible plan for a multi-step task. Use this for implementation, investigation, or research with at least two meaningful steps. Keep exactly one step in progress, mark finished steps completed, and update the plan immediately when progress changes. Do not use it for simple direct answers.",
		inputSchema: z.object({ plan: hostedRunPlanSchema }),
		execute: async ({ plan }) => {
			await publishPlan(plan);
			return { updated: true };
		},
	});
