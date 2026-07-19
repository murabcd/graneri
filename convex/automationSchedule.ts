import { getNextAutomationRunAt as getNextRunAt } from "@workspace/ai/automation-schedule";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const getNextAutomationRunAt = ({
	from,
	schedule,
}: {
	from: number;
	schedule: Doc<"automations">["schedule"];
}) => getNextRunAt({ from, schedule });

export const cancelAutomationSchedule = async (
	ctx: MutationCtx,
	scheduledFunctionId: Id<"_scheduled_functions"> | undefined,
) => {
	if (!scheduledFunctionId) {
		return;
	}

	try {
		await ctx.scheduler.cancel(scheduledFunctionId);
	} catch (error) {
		console.warn("Failed to cancel automation scheduled function", error);
	}
};

export const scheduleAutomationRun = async (
	ctx: MutationCtx,
	automationId: Id<"automations">,
	nextRunAt: number,
) =>
	await ctx.scheduler.runAt(nextRunAt, internal.automations.startScheduledRun, {
		automationId,
		scheduledFor: nextRunAt,
	});

export const scheduleNextAutomationRun = async (
	ctx: MutationCtx,
	automation: Doc<"automations">,
	from: number,
) => {
	const nextRunAt = getNextAutomationRunAt({
		from,
		schedule: automation.schedule,
	});
	if (nextRunAt === null) {
		return { nextRunAt: undefined, scheduledFunctionId: undefined };
	}
	const scheduledFunctionId = await scheduleAutomationRun(
		ctx,
		automation._id,
		nextRunAt,
	);

	return { nextRunAt, scheduledFunctionId };
};
