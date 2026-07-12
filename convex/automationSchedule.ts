import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const getTimeParts = (scheduledAt: number) => {
	const scheduledDate = new Date(scheduledAt);

	return {
		dayOfWeek: scheduledDate.getUTCDay(),
		hours: scheduledDate.getUTCHours(),
		minutes: scheduledDate.getUTCMinutes(),
	};
};

const getDailyCandidate = (from: number, scheduledAt: number) => {
	const { hours, minutes } = getTimeParts(scheduledAt);
	const candidate = new Date(from);
	candidate.setUTCHours(hours, minutes, 0, 0);

	if (candidate.getTime() <= from) {
		candidate.setUTCDate(candidate.getUTCDate() + 1);
	}

	return candidate.getTime();
};

const getHourlyCandidate = (from: number, scheduledAt: number) => {
	const { minutes } = getTimeParts(scheduledAt);
	const candidate = new Date(from);
	candidate.setUTCMinutes(minutes, 0, 0);

	if (candidate.getTime() <= from) {
		candidate.setTime(candidate.getTime() + HOUR_MS);
	}

	return candidate.getTime();
};

const getWeekdayCandidate = (from: number, scheduledAt: number) => {
	let candidate = getDailyCandidate(from, scheduledAt);

	for (let attempt = 0; attempt < 7; attempt += 1) {
		const day = new Date(candidate).getUTCDay();
		if (day >= 1 && day <= 5) {
			return candidate;
		}
		candidate += DAY_MS;
	}

	return candidate;
};

const getWeeklyCandidate = (from: number, scheduledAt: number) => {
	const { dayOfWeek, hours, minutes } = getTimeParts(scheduledAt);
	const candidate = new Date(from);
	candidate.setUTCHours(hours, minutes, 0, 0);

	const dayOffset = (dayOfWeek - candidate.getUTCDay() + 7) % 7;
	candidate.setUTCDate(candidate.getUTCDate() + dayOffset);

	if (candidate.getTime() <= from) {
		candidate.setUTCDate(candidate.getUTCDate() + 7);
	}

	return candidate.getTime();
};

export const getNextAutomationRunAt = ({
	from,
	scheduledAt,
	schedulePeriod,
}: {
	from: number;
	scheduledAt: number;
	schedulePeriod: Doc<"automations">["schedulePeriod"];
}) => {
	switch (schedulePeriod) {
		case "hourly":
			return getHourlyCandidate(from, scheduledAt);
		case "weekdays":
			return getWeekdayCandidate(from, scheduledAt);
		case "weekly":
			return getWeeklyCandidate(from, scheduledAt);
		case "daily":
			return getDailyCandidate(from, scheduledAt);
	}
};

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
	await ctx.scheduler.runAt(
		nextRunAt,
		internal.automationActions.runAutomation,
		{
			automationId,
			scheduledFor: nextRunAt,
			reason: "scheduled",
		},
	);

export const scheduleNextAutomationRun = async (
	ctx: MutationCtx,
	automation: Doc<"automations">,
	from: number,
) => {
	const nextRunAt = getNextAutomationRunAt({
		from,
		scheduledAt: automation.scheduledAt,
		schedulePeriod: automation.schedulePeriod,
	});
	const scheduledFunctionId = await scheduleAutomationRun(
		ctx,
		automation._id,
		nextRunAt,
	);

	return { nextRunAt, scheduledFunctionId };
};
