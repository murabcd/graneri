import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getAssistantRunJob, setAssistantRunWorkflow } from "./assistantRunJobState";
import { assistantRunWorkflow } from "./assistantRunWorkflowManager";

export const scheduleAssistantRunExecution = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
) => {
	const runJob = await getAssistantRunJob(ctx, run._id);
	if (!runJob) {
		throw new Error("Assistant run background job not found.");
	}
	const workflowId = await assistantRunWorkflow.start(
		ctx,
		internal.assistantRunWorkflow.execute,
		{
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			startStepIndex: runJob.execution.completedStepCount,
		},
		{
			startAsync: true,
			onComplete: internal.assistantRunWorkflow.onComplete,
			context: {
				runId: run._id,
				assistantMessageId: run.assistantMessageId,
			},
		},
	);
	await setAssistantRunWorkflow(ctx, run, workflowId);
};
