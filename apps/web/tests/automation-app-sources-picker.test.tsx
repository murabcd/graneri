import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSourcesPicker } from "@/components/automations/automation-app-sources-picker";

afterEach(cleanup);

function AutomationSourcesPickerHarness() {
	const [open, setOpen] = React.useState(false);
	const [webSearchEnabled, setWebSearchEnabled] = React.useState(false);

	return (
		<TooltipProvider>
			<AppSourcesPicker
				open={open}
				onOpenChange={setOpen}
				webSearchEnabled={webSearchEnabled}
				onWebSearchEnabledChange={setWebSearchEnabled}
				onOpenConnectionsSettings={vi.fn()}
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
});
