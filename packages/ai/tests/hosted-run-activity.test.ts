import { describe, expect, it } from "vitest";
import { hostedRunPlanSchema } from "../src/hosted-run-activity.mjs";

const activePlan = [
	{ step: "Inspect the current behavior", status: "completed" as const },
	{ step: "Implement the durable projection", status: "in_progress" as const },
	{ step: "Verify the user interface", status: "pending" as const },
];

describe("hosted run activity", () => {
	it("normalizes plan steps at the tool-input boundary", () => {
		const submittedPlan = activePlan.map((step, index) => ({
			...step,
			step: index === 0 ? `  ${step.step}  ` : step.step,
		}));

		expect(hostedRunPlanSchema.parse(submittedPlan)).toEqual(activePlan);
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
