import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

function TooltipMenu() {
	return (
		<TooltipProvider delayDuration={0}>
			<button type="button">Outside</button>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger>Options</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent>Options hint</TooltipContent>
				</Tooltip>
				<DropdownMenuContent>
					<DropdownMenuItem>Setting</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</TooltipProvider>
	);
}

describe("tooltip overlay focus", () => {
	it("opens a hint when keyboard navigation visibly focuses the trigger", async () => {
		const user = userEvent.setup();
		render(<TooltipMenu />);

		await user.tab();
		await user.tab();

		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "Options" }),
		);
		expect(await screen.findByRole("tooltip")).not.toBeNull();
	});

	it("does not reopen a hint when pointer dismissal restores trigger focus", async () => {
		const user = userEvent.setup();
		render(<TooltipMenu />);
		const trigger = screen.getByRole("button", { name: "Options" });

		await user.hover(trigger);
		expect(await screen.findByRole("tooltip")).not.toBeNull();

		await user.click(trigger);
		expect(screen.getByRole("menuitem", { name: "Setting" })).not.toBeNull();
		expect(screen.queryByRole("tooltip")).toBeNull();

		fireEvent.pointerDown(document.body);
		await waitFor(() =>
			expect(screen.queryByRole("menuitem", { name: "Setting" })).toBeNull(),
		);

		expect(document.activeElement).toBe(trigger);
		expect(screen.queryByRole("tooltip")).toBeNull();
	});
});
