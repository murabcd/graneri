import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const BACKGROUND_RUN_WATCHDOG_MS = 11 * 60 * 1000;

export const scheduleAssistantRunExecution = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
) => {
	await ctx.scheduler.runAfter(0, internal.assistantRunActions.run, {
		runId: run._id,
	});
	await ctx.scheduler.runAfter(
		BACKGROUND_RUN_WATCHDOG_MS,
		internal.assistantRunBackground.expire,
		{
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
		},
	);
};
