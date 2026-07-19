import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { automationDeliveryWorkflow } from "./automationDeliveryWorkflowManager";

export const scheduleAutomationDelivery = async (
	ctx: MutationCtx,
	run: Doc<"automationRuns">,
) => {
	if (run.deliveryWorkflowId) {
		return run.deliveryWorkflowId;
	}
	const workflowId = await automationDeliveryWorkflow.start(
		ctx,
		internal.automationDeliveryWorkflow.execute,
		{ automationRunId: run._id },
		{
			startAsync: true,
			onComplete: internal.automationDeliveryWorkflow.onComplete,
			context: { automationRunId: run._id },
		},
	);
	await ctx.db.patch(run._id, {
		deliveryWorkflowId: workflowId,
		updatedAt: Date.now(),
	});
	return workflowId;
};
