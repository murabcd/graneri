import type { Tool } from "ai";
import type { z } from "zod";

export declare const HOSTED_RUN_ACTIVITY_TOOL_NAME: "update_plan";

export declare const hostedRunPlanSchema: z.ZodType<
	Array<{
		step: string;
		status: "pending" | "in_progress" | "completed";
	}>
>;

export type HostedRunPlan = z.infer<typeof hostedRunPlanSchema>;

export declare const createHostedRunActivityTool: (args: {
	publishPlan: (plan: HostedRunPlan) => Promise<unknown>;
}) => Tool;
