import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import {
	assistantRunActivityValidator,
	assistantRunPlanValidator,
} from "./assistantRunActivityModel";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import {
	isNonTerminalRun,
} from "./assistantRunLifecycle";
import { createResourceAccess } from "./domain";

const { requireTokenIdentifier } = createResourceAccess(
	"assistantRunActivities",
);

const MIN_PLAN_STEPS = 2;
const MAX_PLAN_STEPS = 12;
const MAX_PLAN_STEP_LENGTH = 160;

const invalidPlan = (message: string): never => {
	throw new ConvexError({
		code: "INVALID_ASSISTANT_RUN_PLAN",
		message,
	});
};

const normalizePlan = (
	plan: Doc<"assistantRunActivities">["plan"],
): Doc<"assistantRunActivities">["plan"] => {
	if (plan.length < MIN_PLAN_STEPS || plan.length > MAX_PLAN_STEPS) {
		return invalidPlan(
			`Run plans must contain ${MIN_PLAN_STEPS} to ${MAX_PLAN_STEPS} steps.`,
		);
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
		return invalidPlan(
			`Each run-plan step must contain 1 to ${MAX_PLAN_STEP_LENGTH} characters.`,
		);
	}
	if (new Set(normalizedPlan.map(({ step }) => step)).size !== plan.length) {
		return invalidPlan("Run-plan steps must be unique.");
	}

	const activeStepCount = normalizedPlan.filter(
		({ status }) => status === "in_progress",
	).length;
	const allCompleted = normalizedPlan.every(
		({ status }) => status === "completed",
	);
	if ((!allCompleted && activeStepCount !== 1) || activeStepCount > 1) {
		return invalidPlan(
			"A run plan must have exactly one active step unless every step is completed.",
		);
	}

	let previousRank = 0;
	const statusRank = { completed: 0, in_progress: 1, pending: 2 } as const;
	for (const { status } of normalizedPlan) {
		const rank = statusRank[status];
		if (rank < previousRank) {
			return invalidPlan(
				"Run-plan steps must be ordered as completed, active, then pending.",
			);
		}
		previousRank = rank;
	}

	return normalizedPlan;
};

const requirePublishableRun = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
	ownerTokenIdentifier?: string,
) => {
	const run = await ctx.db.get(runId);
	if (
		!run ||
		(ownerTokenIdentifier !== undefined &&
			run.ownerTokenIdentifier !== ownerTokenIdentifier)
	) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_NOT_FOUND",
			message: "Assistant run not found.",
		});
	}
	if (run.status !== "running") {
		throw new ConvexError({
			code: "ASSISTANT_RUN_NOT_ACTIVE",
			message: "Run activity can only be updated while the run is active.",
		});
	}
	return run;
};

export const publishAssistantRunPlan = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
	plan: Doc<"assistantRunActivities">["plan"],
	ownerTokenIdentifier?: string,
) => {
	const run = await requirePublishableRun(ctx, runId, ownerTokenIdentifier);
	const normalizedPlan = normalizePlan(plan);
	const existingActivity = await ctx.db
		.query("assistantRunActivities")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.unique();
	const updatedAt = Date.now();

	if (existingActivity) {
		await ctx.db.patch(existingActivity._id, {
			plan: normalizedPlan,
			updatedAt,
		});
	} else {
		await ctx.db.insert("assistantRunActivities", {
			ownerTokenIdentifier: run.ownerTokenIdentifier,
			workspaceId: run.workspaceId,
			chatId: run.chatId,
			runId: run._id,
			plan: normalizedPlan,
			updatedAt,
		});
	}

	await appendAssistantRunEvent(ctx, run, {
		type: "plan.updated",
		plan: normalizedPlan,
	});

	return await ctx.db
		.query("assistantRunActivities")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.unique();
};

export const deleteAssistantRunActivity = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const activity = await ctx.db
		.query("assistantRunActivities")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.unique();
	if (activity) {
		await ctx.db.delete(activity._id);
	}
};

export const publishPlan = mutation({
	args: {
		runId: v.id("assistantRuns"),
		plan: assistantRunPlanValidator,
	},
	returns: assistantRunActivityValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const activity = await publishAssistantRunPlan(
			ctx,
			args.runId,
			args.plan,
			ownerTokenIdentifier,
		);
		if (!activity) {
			throw new Error("Failed to publish assistant run activity.");
		}
		return activity;
	},
});

export const publishPlanInternal = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
		plan: assistantRunPlanValidator,
	},
	returns: assistantRunActivityValidator,
	handler: async (ctx, args) => {
		const activity = await publishAssistantRunPlan(ctx, args.runId, args.plan);
		if (!activity) {
			throw new Error("Failed to publish assistant run activity.");
		}
		return activity;
	},
});

export const getActivePlan = query({
	args: {
		runId: v.id("assistantRuns"),
	},
	returns: v.union(v.null(), assistantRunPlanValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const run = await ctx.db.get(args.runId);
		if (
			!run ||
			run.ownerTokenIdentifier !== ownerTokenIdentifier ||
			!isNonTerminalRun(run)
		) {
			return null;
		}
		const activity = await ctx.db
			.query("assistantRunActivities")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.unique();
		return activity?.plan ?? null;
	},
});
