import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatHumanDecisionBar } from "@/components/chat/chat-human-decision-bar";

describe("ChatHumanDecisionBar", () => {
	afterEach(() => {
		cleanup();
	});

	it("shows approval consequence and server-owned input before responding", () => {
		const onRespond = vi.fn();
		render(
			<ChatHumanDecisionBar
				decision={{
					type: "tool_approval",
					approvalId: "approval-1",
					assistantMessageId: "assistant-1",
					authority: {
						access: "write",
						approval: "required",
						provider: "graneri",
					},
					consequence:
						"This action can change data or perform an external action.",
					input: { automationId: "automation-1" },
					toolCallId: "call-1",
					toolName: "delete_automation",
				}}
				onRespond={onRespond}
			/>,
		);

		expect(
			screen.getByText(
				"This action can change data or perform an external action.",
			),
		).not.toBeNull();
		fireEvent.click(screen.getByText("Review action input"));
		expect(screen.getByText(/automation-1/u)).not.toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /Approve/u }));
		expect(onRespond).toHaveBeenCalledWith({
			type: "tool_approval",
			approved: true,
		});
	});

	it("renders bounded clarification choices and their consequence", () => {
		const onRespond = vi.fn();
		render(
			<ChatHumanDecisionBar
				decision={{
					type: "user_question",
					assistantMessageId: "assistant-2",
					toolCallId: "question-1",
					question: "Which scope should I inspect?",
					responseType: "choice",
					consequence: "This determines which files will be read.",
					options: [
						{
							label: "Current folder",
							description: "Inspect this project only.",
						},
						{ label: "All projects", description: "Inspect every project." },
					],
				}}
				onRespond={onRespond}
			/>,
		);

		expect(
			screen.getByText("This determines which files will be read."),
		).not.toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /Current folder/u }));
		expect(onRespond).toHaveBeenCalledWith({
			type: "user_question",
			answer: "Current folder",
		});
	});
});
