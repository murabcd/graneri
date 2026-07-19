import {
	cleanup,
	vResultValidator,
	vWorkflowId,
} from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { failAutomationDelivery } from "./automationRunStateMachine";
import { automationDeliveryWorkflow } from "./automationDeliveryWorkflowManager";

export const execute = automationDeliveryWorkflow
	.define({
		args: { automationRunId: v.id("automationRuns") },
		returns: v.null(),
	})
	.handler(async (step, args): Promise<null> => {
		const decision = await step.runAction(
			internal.automationDeliveryActions.classify,
			args,
			{ retry: true, name: "classify-automation-result" },
		);
		await step.runMutation(
			internal.automations.applyDeliveryDecision,
			{ ...args, ...decision },
			{ name: "apply-automation-delivery" },
		);
		return null;
	});

export const onComplete = internalMutation({
	args: {
		workflowId: vWorkflowId,
		result: vResultValidator,
		context: v.object({ automationRunId: v.id("automationRuns") }),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		if (args.result.kind === "failed") {
			await failAutomationDelivery(
				ctx,
				args.context.automationRunId,
				args.result.error,
			);
		}
		await cleanup(ctx, components.workflow, args.workflowId);
		return null;
	},
});
