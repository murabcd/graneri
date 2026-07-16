import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "./_generated/api";

export const assistantRunWorkflow = new WorkflowManager(components.workflow, {
	workpoolOptions: {
		maxParallelism: 10,
		retryActionsByDefault: false,
		defaultRetryBehavior: {
			maxAttempts: 3,
			initialBackoffMs: 1_000,
			base: 2,
		},
	},
});
