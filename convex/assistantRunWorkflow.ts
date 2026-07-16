import {
	cleanup,
	vResultValidator,
	vWorkflowId,
} from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { transitionAssistantRun } from "./assistantRunStateMachine";
import { assistantRunWorkflow } from "./assistantRunWorkflowManager";

export const MAX_ASSISTANT_RUN_STEPS = 20;

export const execute = assistantRunWorkflow
	.define({
		args: {
			runId: v.id("assistantRuns"),
			assistantMessageId: v.string(),
			startStepIndex: v.number(),
		},
		returns: v.null(),
	})
	.handler(async (step, args): Promise<null> => {
		for (
			let stepIndex = args.startStepIndex;
			stepIndex < MAX_ASSISTANT_RUN_STEPS;
			stepIndex += 1
		) {
			const result = await step.runAction(
				internal.assistantRunActions.runStep,
				{
					runId: args.runId,
					assistantMessageId: args.assistantMessageId,
					stepIndex,
				},
				{ retry: true, name: `assistant-step-${stepIndex}` },
			);
			if (result.outcome === "stale") {
				return null;
			}

			let title: string | null = null;
			if (result.outcome === "completed") {
				try {
					title = await step.runAction(
						internal.assistantRunActions.generateTitle,
						{
							runId: args.runId,
							assistantMessageId: args.assistantMessageId,
						},
						{ retry: true, name: "generate-chat-title" },
					);
				} catch (error) {
					console.error("Assistant chat title generation failed", error);
				}
			}
			const appliedOutcome = await step.runMutation(
				internal.assistantRunBackgroundState.applyStepOutcome,
				{
					runId: args.runId,
					assistantMessageId: args.assistantMessageId,
					stepIndex,
					title: title ?? undefined,
				},
				{ name: `apply-assistant-step-${stepIndex}` },
			);
			if (appliedOutcome !== "continue") {
				return null;
			}
		}

		await step.runMutation(
			internal.assistantRunBackgroundState.reachStepLimit,
			{
				runId: args.runId,
				assistantMessageId: args.assistantMessageId,
				maxSteps: MAX_ASSISTANT_RUN_STEPS,
			},
			{ name: "reach-assistant-step-limit" },
		);
		return null;
	});

export const onComplete = internalMutation({
	args: {
		workflowId: vWorkflowId,
		result: vResultValidator,
		context: v.object({
			runId: v.id("assistantRuns"),
			assistantMessageId: v.string(),
		}),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		if (args.result.kind === "failed") {
			const run = await ctx.db.get(args.context.runId);
			if (
				run?.producer === "convex" &&
				run.status === "running" &&
				run.assistantMessageId === args.context.assistantMessageId
			) {
				await transitionAssistantRun(ctx, run, {
					type: "fail",
					errorText: args.result.error,
				});
			}
		}
		await cleanup(ctx, components.workflow, args.workflowId);
		return null;
	},
});
