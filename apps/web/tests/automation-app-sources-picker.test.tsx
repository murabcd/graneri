import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerProjectOption } from "@/components/ai-elements/composer-project-picker";
import { AppSourcesPicker } from "@/components/automations/automation-app-sources-picker";

afterEach(cleanup);

function AutomationSourcesPickerHarness({
	projectSelectionEnabled = true,
}: {
	projectSelectionEnabled?: boolean;
}) {
	const [open, setOpen] = React.useState(false);
	const [webSearchEnabled, setWebSearchEnabled] = React.useState(false);
	const projects = [
		{
			_id: "project-1",
			name: "Research activities",
			icon: "flask",
			color: "orange",
		},
	] satisfies ComposerProjectOption[];
	const [selectedProject, setSelectedProject] =
		React.useState<ComposerProjectOption | null>(null);

	return (
		<TooltipProvider>
			<AppSourcesPicker
				open={open}
				onOpenChange={setOpen}
				webSearchEnabled={webSearchEnabled}
				onWebSearchEnabledChange={setWebSearchEnabled}
				onOpenConnectionsSettings={vi.fn()}
				projects={projects}
				projectsStatus="ready"
				selectedProject={selectedProject}
				onSelectedProjectChange={setSelectedProject}
				projectSelectionEnabled={projectSelectionEnabled}
			/>
		</TooltipProvider>
	);
}

describe("automation app sources picker", () => {
	it("shows enabled Web search in the composer and removes it directly", async () => {
		const user = userEvent.setup();
		render(<AutomationSourcesPickerHarness />);

		await user.click(screen.getByRole("button", { name: "Select scope" }));
		await user.click(screen.getByRole("switch", { name: "Web search" }));
		await user.keyboard("{Escape}");

		const webControl = screen.getByRole("button", {
			name: "Turn off Web search",
		});
		expect(webControl.textContent).toContain("Web");
		expect(webControl.querySelectorAll("svg")).toHaveLength(2);

		await user.click(webControl);

		expect(
			screen.queryByRole("button", { name: "Turn off Web search" }),
		).toBeNull();
	});

	it("shows the selected cloud project and removes it directly", async () => {
		const user = userEvent.setup();
		render(<AutomationSourcesPickerHarness />);

		await user.click(screen.getByRole("button", { name: "Select scope" }));
		await user.click(screen.getByRole("menuitem", { name: "Choose project" }));
		fireEvent.click(
			screen.getByRole("option", { name: "Research activities" }),
		);

		const projectControl = screen.getByRole("button", {
			name: "Remove Research activities",
		});
		expect(projectControl.textContent).toContain("Research activities");
		expect(
			projectControl
				.querySelector(".lucide-flask-conical")
				?.classList.contains("text-orange-500"),
		).toBe(true);

		await user.click(projectControl);
		expect(
			screen.queryByRole("button", { name: "Remove Research activities" }),
		).toBeNull();
	});

	it("hides project assignment for chat-linked automations", async () => {
		const user = userEvent.setup();
		render(<AutomationSourcesPickerHarness projectSelectionEnabled={false} />);

		await user.click(screen.getByRole("button", { name: "Select scope" }));

		expect(
			screen.queryByRole("menuitem", { name: "Choose project" }),
		).toBeNull();
	});
});
