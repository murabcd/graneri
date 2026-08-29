import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatModelPicker } from "@/components/chat/model-picker";
import {
	chatModels,
	type ReasoningEffort,
	type ServiceTier,
} from "@/lib/ai/models";

afterEach(cleanup);

function ModelPickerHarness() {
	const [open, setOpen] = React.useState(false);
	const [selectedModel, setSelectedModel] = React.useState(chatModels[0]);
	const [reasoningEffort, setReasoningEffort] =
		React.useState<ReasoningEffort>("low");
	const [serviceTier, setServiceTier] = React.useState<ServiceTier>("auto");

	return (
		<TooltipProvider>
			<ChatModelPicker
				open={open}
				onOpenChange={setOpen}
				selectedModel={selectedModel}
				onSelectedModelChange={setSelectedModel}
				reasoningEffort={reasoningEffort}
				onReasoningEffortChange={setReasoningEffort}
				serviceTier={serviceTier}
				onServiceTierChange={setServiceTier}
			/>
		</TooltipProvider>
	);
}

async function openPicker() {
	const user = userEvent.setup();
	const trigger = screen.getByRole("button", { name: "Model: 5.6 Sol" });
	await user.click(trigger);
	expect(
		screen.getByRole("menuitemcheckbox", { name: "GPT-5.6 Sol" }),
	).not.toBeNull();
	return user;
}

async function openSubmenu(name: string) {
	const submenuTrigger = screen.getByRole("menuitem", { name });
	submenuTrigger.focus();
	fireEvent.keyDown(submenuTrigger, { key: "ArrowRight" });
	await waitFor(() =>
		expect(submenuTrigger.getAttribute("data-state")).toBe("open"),
	);
}

describe("chat model picker", () => {
	it("stays open after changing the model and closes on outside click", async () => {
		render(<ModelPickerHarness />);
		const user = await openPicker();

		await user.click(
			screen.getByRole("menuitemcheckbox", { name: "GPT-5.6 Terra" }),
		);

		expect(
			screen.getByRole("menuitemcheckbox", { name: "GPT-5.6 Terra" }),
		).not.toBeNull();

		fireEvent.pointerDown(document.body);
		await waitFor(() =>
			expect(
				screen.queryByRole("menuitemcheckbox", { name: "GPT-5.6 Terra" }),
			).toBeNull(),
		);
	});

	it("stays open after changing reasoning effort", async () => {
		render(<ModelPickerHarness />);
		const user = await openPicker();
		await openSubmenu("Light");

		await user.click(screen.getByRole("menuitemradio", { name: "High" }));

		expect(
			screen.getByRole("menuitemcheckbox", { name: "GPT-5.6 Sol" }),
		).not.toBeNull();
	});

	it("stays open after changing speed", async () => {
		render(<ModelPickerHarness />);
		const user = await openPicker();
		await openSubmenu("Standard");

		await user.click(screen.getByRole("menuitemradio", { name: "Fast" }));

		expect(
			screen.getByRole("menuitemcheckbox", { name: "GPT-5.6 Sol" }),
		).not.toBeNull();
	});
});
