import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ChatQueuedFollowUpBar,
	type QueuedFollowUpBarItem,
} from "../src/components/chat/chat-queued-follow-up-bar";

const createQueuedFollowUp = (
	overrides: Partial<QueuedFollowUpBarItem> = {},
): QueuedFollowUpBarItem => ({
	actionLabel: "Retry",
	id: "queued-1",
	helpText: undefined,
	isActionDisabled: false,
	isEditing: false,
	isSendingNow: false,
	isUpdatingFollowUpBehavior: false,
	followUpBehavior: "queue",
	onDelete: vi.fn(),
	onEdit: vi.fn(),
	onFollowUpBehaviorChange: vi.fn(),
	onSendNow: vi.fn(),
	pauseReason: "failed",
	statusLabel: "Paused",
	text: "Queued follow-up: Continue",
	...overrides,
});

describe("chat queued follow-up bar", () => {
	afterEach(cleanup);

	it("renders paused rows without a separate interruption banner", async () => {
		const user = userEvent.setup();
		const interruptedFollowUp = createQueuedFollowUp({
			actionLabel: null,
			id: "queued-1",
			helpText: undefined,
			pauseReason: "interrupted",
		});
		render(
			<TooltipProvider delayDuration={0}>
				<ChatQueuedFollowUpBar
					queuedFollowUps={[
						interruptedFollowUp,
						createQueuedFollowUp({ id: "queued-2" }),
					]}
				/>
			</TooltipProvider>,
		);

		expect(
			screen.queryByText("Queue paused because you interrupted"),
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
		expect(
			screen.getByText("This queued message could not be sent"),
		).not.toBeNull();
		expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
		expect(screen.queryByRole("button", { name: "Steer" })).toBeNull();
		expect(screen.queryByText("Turn off")).toBeNull();
		expect(
			screen.getAllByRole("button", { name: "Delete queued message" }),
		).toHaveLength(2);

		await user.click(
			screen.getAllByRole("button", {
				name: "More queued message actions",
			})[0] as HTMLElement,
		);
		await user.click(screen.getByRole("menuitem", { name: "Turn off" }));
		expect(interruptedFollowUp.onDelete).not.toHaveBeenCalled();
		expect(interruptedFollowUp.onFollowUpBehaviorChange).toHaveBeenCalledWith(
			"steer",
		);
	});

	it("turns queueing back on without changing the queued row", async () => {
		const user = userEvent.setup();
		const queuedFollowUp = createQueuedFollowUp({ followUpBehavior: "steer" });
		render(
			<TooltipProvider delayDuration={0}>
				<ChatQueuedFollowUpBar queuedFollowUps={[queuedFollowUp]} />
			</TooltipProvider>,
		);

		await user.click(
			screen.getByRole("button", { name: "More queued message actions" }),
		);
		await user.click(screen.getByRole("menuitem", { name: "Turn on" }));

		expect(queuedFollowUp.onDelete).not.toHaveBeenCalled();
		expect(queuedFollowUp.onFollowUpBehaviorChange).toHaveBeenCalledWith(
			"queue",
		);
	});
});
