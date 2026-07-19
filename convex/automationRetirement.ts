import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { stopAutomationRun } from "./automationRunStateMachine";
import { cancelAutomationSchedule } from "./automationSchedule";

const DELETE_RUNS_BATCH_SIZE = 50;
const DELETE_AUTOMATIONS_BATCH_SIZE = 50;

export const removeOrphanedAutomationRuns = async (
	ctx: MutationCtx,
	automationId: Id<"automations">,
) => {
	if (await ctx.db.get(automationId)) {
		return { deletedCount: 0, hasMore: false };
	}

	const runs = await ctx.db
		.query("automationRuns")
		.withIndex("by_automationId_and_scheduledFor", (q) =>
			q.eq("automationId", automationId),
		)
		.take(DELETE_RUNS_BATCH_SIZE);
	await Promise.all(runs.map((run) => ctx.db.delete(run._id)));
	const hasMore = runs.length === DELETE_RUNS_BATCH_SIZE;

	if (hasMore) {
		await ctx.scheduler.runAfter(0, internal.automations.removeOrphanedRuns, {
			automationId,
		});
	}

	return { deletedCount: runs.length, hasMore };
};

export const removeAllAutomationsForOwner = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
) => {
	const runs = await ctx.db
		.query("automationRuns")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.take(DELETE_RUNS_BATCH_SIZE);

	await Promise.all(
		runs.map(async (run) => {
			if (run.status === "running") {
				const automation = await ctx.db.get(run.automationId);
				if (automation) {
					await ctx.db.patch(automation._id, {
						isPaused: true,
						nextRunAt: undefined,
						scheduledFunctionId: undefined,
						updatedAt: Date.now(),
					});
					await stopAutomationRun(ctx, {
						automationId: automation._id,
						runId: run._id,
					});
				}
			}
			await ctx.db.delete(run._id);
		}),
	);

	if (runs.length === DELETE_RUNS_BATCH_SIZE) {
		await ctx.scheduler.runAfter(0, internal.automations.removeAllForOwner, {
			ownerTokenIdentifier,
		});
		return;
	}

	const automations = await ctx.db
		.query("automations")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.take(DELETE_AUTOMATIONS_BATCH_SIZE);
	await Promise.all(
		automations.map(async (automation) => {
			await cancelAutomationSchedule(ctx, automation.scheduledFunctionId);
			await ctx.db.delete(automation._id);
		}),
	);

	if (automations.length === DELETE_AUTOMATIONS_BATCH_SIZE) {
		await ctx.scheduler.runAfter(0, internal.automations.removeAllForOwner, {
			ownerTokenIdentifier,
		});
	}
};
