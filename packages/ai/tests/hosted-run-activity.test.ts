import { describe, expect, it, vi } from "vitest";
import {
	createHostedRunActivityTool,
	hostedRunPlanSchema,
} from "../src/hosted-run-activity.mjs";

const activePlan = [
	{ step: "Inspect the current behavior", status: "completed" as const },
	{ step: "Implement the durable projection", status: "in_progress" as const },
	{ step: "Verify the user interface", status: "pending" as const },
];

describe("hosted run activity", () => {
	it("publishes a canonical plan through the AI SDK tool", async () => {
		const publishPlan = vi.fn();
		const runActivityTool = createHostedRunActivityTool({ publishPlan });

		await expect(
			runActivityTool.execute?.(
				{ plan: activePlan },
				{ messages: [], toolCallId: "plan-call-1" },
			),
		).resolves.toEqual({ updated: true });
		expect(publishPlan).toHaveBeenCalledWith(activePlan);
	});

	it("rejects plans whose lifecycle order cannot be rendered predictably", () => {
		expect(
			hostedRunPlanSchema.safeParse([
				{ step: "Future work", status: "pending" },
				{ step: "Current work", status: "in_progress" },
			]),
		).toMatchObject({ success: false });
	});

	it("accepts a fully completed plan", () => {
		expect(
			hostedRunPlanSchema.safeParse(
				activePlan.map(({ step }) => ({ step, status: "completed" })),
			),
		).toMatchObject({ success: true });
	});
});
