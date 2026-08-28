import { tool } from "ai";
import { z } from "zod";

export const HOSTED_RUN_ACTIVITY_TOOL_NAME = "update_plan";

const runPlanStepSchema = z.object({
	step: z.string(),
	status: z.enum(["pending", "in_progress", "completed"]),
});

const MIN_PLAN_STEPS = 2;
const MAX_PLAN_STEPS = 12;
const MAX_PLAN_STEP_LENGTH = 160;

export const normalizeHostedRunPlan = (plan) => {
	if (plan.length < MIN_PLAN_STEPS || plan.length > MAX_PLAN_STEPS) {
		return {
			ok: false,
			error: `Run plans must contain ${MIN_PLAN_STEPS} to ${MAX_PLAN_STEPS} steps.`,
		};
	}

	const normalizedPlan = plan.map(({ status, step }) => ({
		status,
		step: step.trim(),
	}));
	if (
		normalizedPlan.some(
			({ step }) => step.length === 0 || step.length > MAX_PLAN_STEP_LENGTH,
		)
	) {
		return {
			ok: false,
			error: `Each run-plan step must contain 1 to ${MAX_PLAN_STEP_LENGTH} characters.`,
		};
	}
	if (new Set(normalizedPlan.map(({ step }) => step)).size !== plan.length) {
		return { ok: false, error: "Run-plan steps must be unique." };
	}

	const activeStepCount = normalizedPlan.filter(
		({ status }) => status === "in_progress",
	).length;
	const allCompleted = normalizedPlan.every(
		({ status }) => status === "completed",
	);
	if (!allCompleted && activeStepCount !== 1) {
		return {
			ok: false,
			error:
				"A run plan must have exactly one active step unless every step is completed.",
		};
	}

	let previousRank = 0;
	const statusRank = { completed: 0, in_progress: 1, pending: 2 };
	for (const { status } of normalizedPlan) {
		const rank = statusRank[status];
		if (rank < previousRank) {
			return {
				ok: false,
				error:
					"Run-plan steps must be ordered as completed, active, then pending.",
			};
		}
		previousRank = rank;
	}

	return { ok: true, plan: normalizedPlan };
};

export const hostedRunPlanSchema = z
	.array(runPlanStepSchema)
	.transform((plan, context) => {
		const result = normalizeHostedRunPlan(plan);
		if (!result.ok) {
			context.addIssue({ code: "custom", message: result.error });
			return z.NEVER;
		}
		return result.plan;
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
