import { normalizeHostedRunPlan } from "@workspace/ai/hosted-run-activity";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import {
	assistantRunActivityValidator,
	assistantRunPlanValidator,
} from "./assistantRunActivityModel";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import { isNonTerminalRun } from "./assistantRunLifecycle";
import { createResourceAccess } from "./domain";

const { requireTokenIdentifier } = createResourceAccess(
	"assistantRunActivities",
);

const invalidPlan = (message: string): never => {
	throw new ConvexError({
		code: "INVALID_ASSISTANT_RUN_PLAN",
		message,
	});
};

const normalizePlan = (
	plan: Doc<"assistantRunActivities">["plan"],
): Doc<"assistantRunActivities">["plan"] => {
	const result = normalizeHostedRunPlan(plan);
	return result.ok ? result.plan : invalidPlan(result.error);
};

const requirePublishableRun = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const run = await ctx.db.get(runId);
	if (!run) {
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

const requireOwnedPublishableRun = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
	ownerTokenIdentifier: string,
) => {
	const run = await requirePublishableRun(ctx, runId);
	if (run.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_NOT_FOUND",
			message: "Assistant run not found.",
		});
	}
	return run;
};

const publishAssistantRunPlan = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	plan: Doc<"assistantRunActivities">["plan"],
) => {
	const normalizedPlan = normalizePlan(plan);
	const existingActivity = await ctx.db
		.query("assistantRunActivities")
		.withIndex("by_runId", (q) => q.eq("runId", run._id))
		.unique();
	const updatedAt = Date.now();
	let activityId: Id<"assistantRunActivities">;

	if (existingActivity) {
		activityId = existingActivity._id;
		await ctx.db.patch(existingActivity._id, {
			plan: normalizedPlan,
			updatedAt,
		});
	} else {
		activityId = await ctx.db.insert("assistantRunActivities", {
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

	const activity = await ctx.db.get(activityId);
	if (!activity) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
			message: "Published assistant run activity was not found.",
		});
	}
	return activity;
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
		const run = await requireOwnedPublishableRun(
			ctx,
			args.runId,
			ownerTokenIdentifier,
		);
		return await publishAssistantRunPlan(ctx, run, args.plan);
	},
});

export const publishPlanInternal = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
		plan: assistantRunPlanValidator,
	},
	returns: assistantRunActivityValidator,
	handler: async (ctx, args) => {
		const run = await requirePublishableRun(ctx, args.runId);
		return await publishAssistantRunPlan(ctx, run, args.plan);
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
