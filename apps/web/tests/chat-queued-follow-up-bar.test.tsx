import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
	isDeleting: false,
	isEditing: false,
	isSendingNow: false,
	onDelete: vi.fn(),
	onEdit: vi.fn(),
	onSendNow: vi.fn(),
	pauseReason: "failed",
	statusLabel: "Paused",
	text: "Queued follow-up: Continue",
	...overrides,
});

describe("chat queued follow-up bar", () => {
	afterEach(cleanup);

	it("renders the paused interruption and failed-head actions without a send action on interrupted rows", () => {
		const onResume = vi.fn();
		render(
			<TooltipProvider delayDuration={0}>
				<ChatQueuedFollowUpBar
					isResuming={false}
					onResume={onResume}
					queuedFollowUps={[
						createQueuedFollowUp({
							actionLabel: null,
							id: "queued-1",
							helpText: undefined,
							pauseReason: "interrupted",
						}),
						createQueuedFollowUp({ id: "queued-2" }),
					]}
				/>
			</TooltipProvider>,
		);

		expect(
			screen.getByText("Queue paused because you interrupted"),
		).not.toBeNull();
		expect(screen.getByRole("button", { name: "Resume" })).not.toBeNull();
		expect(
			screen.getByText("This queued message could not be sent"),
		).not.toBeNull();
		expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
		expect(screen.queryByRole("button", { name: "Steer" })).toBeNull();
		expect(screen.queryByText("Turn off")).toBeNull();
		expect(
			screen.getAllByRole("button", { name: "Delete queued message" }),
		).toHaveLength(2);

		fireEvent.click(screen.getByRole("button", { name: "Resume" }));
		expect(onResume).toHaveBeenCalledOnce();
	});

	it("disables resume while queue recovery is already in progress", () => {
		render(
			<TooltipProvider delayDuration={0}>
				<ChatQueuedFollowUpBar
					isResuming
					onResume={vi.fn()}
					queuedFollowUps={[
						createQueuedFollowUp({
							actionLabel: null,
							pauseReason: "interrupted",
						}),
					]}
				/>
			</TooltipProvider>,
		);

		expect(
			screen.getByRole("button", { name: "Resume" }).hasAttribute("disabled"),
		).toBe(true);
	});
});
