import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RunPlanProgress } from "@/components/chat/run-plan-progress";

const plan = [
	{ step: "Inspect the current behavior", status: "completed" as const },
	{ step: "Implement the durable projection", status: "in_progress" as const },
	{ step: "Verify the user interface", status: "pending" as const },
];

describe("RunPlanProgress", () => {
	it("shows the active step in a floating badge and reveals the plan on hover", async () => {
		const user = userEvent.setup();
		render(<RunPlanProgress plan={plan} />);

		const trigger = screen.getByRole("button", {
			name: "Step 2 of 3. Show plan",
		});
		expect(trigger.textContent).toContain("Step 2 / 3");

		await user.hover(trigger);
		expect(
			await screen.findByRole("list", { name: "Run plan" }),
		).not.toBeNull();
		expect(screen.getByText("Inspect the current behavior")).not.toBeNull();
		expect(screen.getByText("Implement the durable projection")).not.toBeNull();
		expect(screen.getByText("Verify the user interface")).not.toBeNull();
	});
});
