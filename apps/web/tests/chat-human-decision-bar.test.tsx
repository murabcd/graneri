import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatHumanDecisionBar } from "@/components/chat/chat-human-decision-bar";

const option = (label: string, description: string) => ({
	label,
	description,
});

describe("ChatHumanDecisionBar", () => {
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("shows a compact permission card without implementation details", () => {
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
					consequence: "This action will permanently delete the automation.",
					input: { automationId: "automation-1" },
					toolCallId: "call-1",
					toolName: "delete_automation",
				}}
				onRespond={onRespond}
			/>,
		);

		expect(screen.queryByText("Write access")).toBeNull();
		expect(
			screen.getByText("Allow Graneri to delete automation?"),
		).not.toBeNull();
		expect(
			screen.queryByText("This action will permanently delete the automation."),
		).toBeNull();
		expect(screen.getByText("Approval")).not.toBeNull();
		expect(screen.queryByText(/Connected service:/u)).toBeNull();
		expect(screen.queryByText("Review action input")).toBeNull();
		expect(screen.queryByText(/automation-1/u)).toBeNull();
		expect(
			document.querySelector('[data-slot="approval-status-icon"]'),
		).not.toBeNull();
		expect(
			document
				.querySelector('[data-slot="approval-status-icon"]')
				?.classList.contains("text-emerald-500"),
		).toBe(true);
		expect(
			screen
				.getByText("Allow Graneri to delete automation?")
				.classList.contains("text-muted-foreground"),
		).toBe(true);
		expect(
			screen.getByText("Approval").parentElement?.classList.contains("flex"),
		).toBe(true);

		const approve = screen.getByRole("button", { name: /Allow once/u });
		const deny = screen.getByRole("button", { name: /Deny/u });
		expect(approve.getAttribute("aria-keyshortcuts")).toBe("Enter");
		expect(deny.getAttribute("aria-keyshortcuts")).toBe("Escape");
		expect(approve.textContent).toBe("Allow once");
		expect(deny.textContent).toBe("Deny");
		expect(approve.parentElement).toBe(deny.parentElement);
		expect(approve.parentElement?.lastElementChild).toBe(approve);
		expect(approve.parentElement?.classList.contains("border-t-0")).toBe(true);

		fireEvent.click(approve);
		expect(onRespond).toHaveBeenCalledWith({
			type: "tool_approval",
			approved: true,
		});
	});

	it("supports approval shortcuts without overriding interactive controls", () => {
		const onRespond = vi.fn();
		render(
			<>
				<input aria-label="Unrelated input" />
				<ChatHumanDecisionBar
					decision={{
						type: "tool_approval",
						approvalId: "approval-2",
						assistantMessageId: "assistant-2",
						authority: {
							access: "write",
							approval: "required",
							provider: "graneri",
						},
						consequence: "This action will update the note.",
						input: { noteId: "note-1" },
						toolCallId: "call-2",
						toolName: "update_note",
					}}
					onRespond={onRespond}
				/>
			</>,
		);

		const unrelatedInput = screen.getByRole("textbox", {
			name: "Unrelated input",
		});
		fireEvent.keyDown(unrelatedInput, { key: "Enter" });
		expect(onRespond).not.toHaveBeenCalled();

		fireEvent.keyDown(document, { key: "Enter" });
		expect(onRespond).toHaveBeenLastCalledWith({
			type: "tool_approval",
			approved: true,
		});

		onRespond.mockClear();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(onRespond).toHaveBeenCalledWith({
			type: "tool_approval",
			approved: false,
		});
	});

	it("renders described numbered choices and submits one choice immediately", () => {
		vi.useFakeTimers();
		const onRespond = vi.fn();
		render(
			<ChatHumanDecisionBar
				decision={{
					type: "user_question",
					assistantMessageId: "assistant-2",
					toolCallId: "question-1",
					questions: [
						{
							id: "scope",
							question: "Which scope should I inspect?",
							options: [
								option(
									"Current folder (Recommended)",
									"Use only the current folder.",
								),
								option("All projects", "Use all available projects."),
							],
						},
					],
				}}
				onRespond={onRespond}
			/>,
		);

		expect(
			screen.getByRole("group", { name: "Which scope should I inspect?" }),
		).not.toBeNull();
		expect(screen.getByText("Question")).not.toBeNull();
		expect(
			document.querySelector('[data-slot="question-status-icon"]'),
		).not.toBeNull();
		expect(
			document
				.querySelector('[data-slot="question-status-icon"]')
				?.classList.contains("text-blue-500"),
		).toBe(true);
		expect(
			screen
				.getByText("Which scope should I inspect?")
				.classList.contains("text-muted-foreground"),
		).toBe(true);
		expect(screen.getByText("Recommended")).not.toBeNull();
		expect(screen.getByText("Use only the current folder.")).not.toBeNull();
		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(screen.getAllByRole("radio")).toHaveLength(2);
		expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
		expect(
			screen.getByRole("textbox", { name: "Other answer" }),
		).toHaveProperty("placeholder", "Something else...");

		const currentFolder = screen.getByRole("radio", {
			name: /Current folder.*Use only the current folder/u,
		});
		const allProjects = screen.getByRole("radio", {
			name: /All projects.*Use all available projects/u,
		});
		const optionGroup = screen.getByRole("radiogroup", {
			name: "Which scope should I inspect?",
		});
		expect(currentFolder.getAttribute("aria-keyshortcuts")).toBe("1");
		expect(currentFolder.getAttribute("aria-checked")).toBe("false");
		expect(currentFolder.classList.contains("bg-muted")).toBe(false);
		fireEvent.pointerEnter(allProjects);
		expect(currentFolder.classList.contains("bg-muted")).toBe(false);
		expect(allProjects.classList.contains("bg-muted")).toBe(true);
		fireEvent.pointerLeave(optionGroup);
		expect(currentFolder.classList.contains("bg-muted")).toBe(false);
		expect(allProjects.classList.contains("bg-muted")).toBe(false);
		fireEvent.click(currentFolder);
		expect(currentFolder.firstElementChild?.textContent).toBe("1");
		expect(onRespond).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(180));
		expect(onRespond).toHaveBeenCalledWith({
			type: "user_question",
			answer: "> Which scope should I inspect?\nCurrent folder",
		});
	});

	it("uses one Yes or No question per independent choice", () => {
		vi.useFakeTimers();
		const onRespond = vi.fn();
		const yes = option("Yes (Recommended)", "Allow this source.");
		const no = option("No", "Do not use this source.");
		render(
			<ChatHumanDecisionBar
				decision={{
					type: "user_question",
					assistantMessageId: "assistant-3",
					toolCallId: "question-2",
					questions: [
						{
							id: "notes",
							question: "May I use Notes?",
							options: [yes, no],
						},
						{
							id: "files",
							question: "May I use Files?",
							options: [yes, no],
						},
						{
							id: "web",
							question: "May I use the Web?",
							options: [yes, no],
						},
					],
				}}
				onRespond={onRespond}
			/>,
		);

		const yesOption = screen.getByRole("radio", { name: /Yes.*Allow/u });
		const noOption = screen.getByRole("radio", {
			name: /No.*Do not use/u,
		});
		expect(yesOption.getAttribute("aria-checked")).toBe("false");
		expect(noOption.getAttribute("aria-checked")).toBe("false");
		fireEvent.keyDown(document, { key: "ArrowDown" });
		expect(yesOption.getAttribute("aria-checked")).toBe("true");
		fireEvent.keyDown(document, { key: "ArrowDown" });
		expect(noOption.getAttribute("aria-checked")).toBe("true");
		fireEvent.keyDown(document, { key: "ArrowUp" });
		expect(yesOption.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(yesOption);
		act(() => vi.advanceTimersByTime(180));
		expect(screen.getByText("2 of 3")).not.toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Previous question" }));
		expect(
			screen
				.getByRole("radio", { name: /Yes.*Allow/u })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			screen
				.getByRole("radio", { name: /Yes.*Allow/u })
				.classList.contains("bg-muted"),
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Next question" }));

		fireEvent.click(screen.getByRole("radio", { name: /No.*Do not use/u }));
		act(() => vi.advanceTimersByTime(180));
		expect(screen.getByText("3 of 3")).not.toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Skip" }));
		expect(onRespond).toHaveBeenCalledWith({
			type: "user_question",
			answer:
				"> May I use Notes?\nYes\n\n> May I use Files?\nNo\n\n> May I use the Web?\nSkipped",
		});
	});

	it("supports numeric shortcuts, free-form answers, and closing unresolved questions", () => {
		vi.useFakeTimers();
		const onRespond = vi.fn();
		const decision = {
			type: "user_question" as const,
			assistantMessageId: "assistant-4",
			toolCallId: "question-3",
			questions: [
				{
					id: "scope",
					question: "Which scope?",
					options: [
						option("Current", "Use the current scope."),
						option("All", "Use every available scope."),
					],
				},
				{
					id: "format",
					question: "Which format?",
					options: [
						option("Summary", "Return a summary."),
						option("Table", "Return a table."),
					],
				},
			],
		};
		const { unmount } = render(
			<ChatHumanDecisionBar decision={decision} onRespond={onRespond} />,
		);
		const questionnaire = screen.getByRole("group", {
			name: "Which scope?",
		});
		expect(questionnaire).toHaveProperty("tabIndex", 0);
		expect(document.activeElement).toBe(questionnaire);

		fireEvent.keyDown(document, { key: "2" });
		act(() => vi.advanceTimersByTime(180));
		expect(screen.getByText("2 of 2")).not.toBeNull();
		const other = screen.getByRole("textbox", { name: "Other answer" });
		fireEvent.change(other, { target: { value: "Checklist" } });
		fireEvent.keyDown(other, { key: "Enter" });
		expect(onRespond).toHaveBeenCalledWith({
			type: "user_question",
			answer: "> Which scope?\nAll\n\n> Which format?\nChecklist",
		});

		unmount();
		onRespond.mockClear();
		render(<ChatHumanDecisionBar decision={decision} onRespond={onRespond} />);
		const close = screen.getByRole("button", { name: "Close questions" });
		expect(close.getAttribute("aria-keyshortcuts")).toBe("Escape");
		const otherAnswer = screen.getByRole("textbox", { name: "Other answer" });
		otherAnswer.focus();
		fireEvent.keyDown(otherAnswer, { key: "1" });
		expect(onRespond).not.toHaveBeenCalled();
		fireEvent.keyDown(otherAnswer, { key: "Escape" });
		expect(onRespond).toHaveBeenCalledWith({
			type: "user_question",
			answer: "> Which scope?\nSkipped\n\n> Which format?\nSkipped",
		});
	});

	it("confirms the keyboard-selected question option with Enter", () => {
		vi.useFakeTimers();
		const onRespond = vi.fn();
		render(
			<ChatHumanDecisionBar
				decision={{
					type: "user_question",
					assistantMessageId: "assistant-5",
					toolCallId: "question-4",
					questions: [
						{
							id: "scope",
							question: "Which scope?",
							options: [
								option("Current", "Use the current scope."),
								option("All", "Use every available scope."),
							],
						},
					],
				}}
				onRespond={onRespond}
			/>,
		);

		fireEvent.keyDown(document, { key: "ArrowDown" });
		expect(
			screen
				.getByRole("radio", { name: /Current.*current scope/u })
				.getAttribute("aria-checked"),
		).toBe("true");
		fireEvent.keyDown(document, { key: "Enter" });
		expect(onRespond).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(180));
		expect(onRespond).toHaveBeenCalledWith({
			type: "user_question",
			answer: "> Which scope?\nCurrent",
		});
	});
});
