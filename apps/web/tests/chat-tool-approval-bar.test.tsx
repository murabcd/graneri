import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatToolApprovalBar } from "@/components/chat/chat-tool-approval-bar";

describe("ChatToolApprovalBar", () => {
	afterEach(() => {
		cleanup();
	});

	it("shows the action consequence and server-owned input before approval", () => {
		const onRespond = vi.fn();
		render(
			<ChatToolApprovalBar
				approval={{
					approvalId: "approval-1",
					assistantMessageId: "assistant-1",
					authority: {
						access: "write",
						approval: "required",
						provider: "graneri",
					},
					input: { automationId: "automation-1" },
					toolCallId: "call-1",
					toolName: "delete_automation",
				}}
				onRespond={onRespond}
			/>,
		);

		expect(
			screen.getByText("This action can change data in Graneri."),
		).not.toBeNull();
		fireEvent.click(screen.getByText("Review action input"));
		expect(screen.getByText(/automation-1/u)).not.toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Approve" }));
		expect(onRespond).toHaveBeenCalledWith(true);
	});
});
