import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MessageScroller,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMessageListContent } from "../src/components/chat/message-list";

const streamingReasoningMessage: UIMessage = {
	id: "assistant-1",
	role: "assistant",
	parts: [
		{ type: "reasoning", text: "", state: "streaming" },
		{ type: "text", text: "", state: "streaming" },
	],
};

const streamingToolMessage: UIMessage = {
	id: streamingReasoningMessage.id,
	role: "assistant",
	parts: [
		{
			type: "tool-run_local_command",
			toolCallId: "call-streaming",
			state: "input-available",
			input: { command: "pwd" },
		},
	],
};

const completedReasoningMessage: UIMessage = {
	id: "assistant-2",
	role: "assistant",
	parts: [
		{
			type: "reasoning",
			text: "Reviewed the current renderer and reused its reasoning part.",
			state: "done",
		},
	],
};

const completedToolAndReasoningMessage: UIMessage = {
	id: "assistant-3",
	role: "assistant",
	parts: [
		{
			type: "tool-run_local_command",
			toolCallId: "call-1",
			state: "output-available",
			input: { command: "pwd" },
			output: { path: "/workspace" },
		},
		{
			type: "dynamic-tool",
			toolCallId: "transport-1",
			toolName: "internal_transport",
			state: "output-available",
			input: {},
			output: {},
		},
		{
			type: "reasoning",
			text: "Reviewed the tool result before answering.",
			state: "done",
		},
	],
};

const completedTurnWorkMessage: UIMessage = {
	...completedToolAndReasoningMessage,
	id: streamingReasoningMessage.id,
};

const assistantContinuationMessage: UIMessage = {
	id: "assistant-continuation",
	role: "assistant",
	parts: [],
};

const renderMessageList = ({
	isLoading,
	messages,
}: {
	isLoading?: boolean;
	messages: UIMessage[];
}) => (
	<TooltipProvider>
		<MessageScrollerProvider autoScroll>
			<MessageScroller>
				<MessageScrollerViewport>
					<ChatMessageListContent isLoading={isLoading} messages={messages} />
				</MessageScrollerViewport>
			</MessageScroller>
		</MessageScrollerProvider>
	</TooltipProvider>
);

describe("chat message thinking status", () => {
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("keeps one work disclosure open for the active turn and collapses it on completion", () => {
		const { rerender } = render(
			renderMessageList({
				isLoading: true,
				messages: [{ id: "assistant-1", role: "assistant", parts: [] }],
			}),
		);

		expect(screen.getAllByText("Thinking")).toHaveLength(1);
		expect(screen.queryByRole("button", { name: "Working" })).toBeNull();

		rerender(
			renderMessageList({
				isLoading: true,
				messages: [streamingReasoningMessage],
			}),
		);

		expect(
			screen
				.getByRole("button", { name: /^Working/ })
				.getAttribute("aria-expanded"),
		).toBe("true");
		expect(screen.getAllByText("Thinking")).toHaveLength(1);

		rerender(
			renderMessageList({
				isLoading: true,
				messages: [completedTurnWorkMessage, assistantContinuationMessage],
			}),
		);

		expect(
			screen
				.getByRole("button", { name: /^Working.*1 call/ })
				.getAttribute("aria-expanded"),
		).toBe("true");
		expect(screen.queryByText("Thinking")).toBeNull();
		expect(screen.getByRole("button", { name: "Thought" })).not.toBeNull();

		rerender(
			renderMessageList({
				messages: [completedTurnWorkMessage, assistantContinuationMessage],
			}),
		);

		expect(
			screen
				.getByRole("button", { name: /^Worked.*1 call/ })
				.getAttribute("aria-expanded"),
		).toBe("false");
		expect(screen.queryByRole("button", { name: "Thought" })).toBeNull();
	});

	it("never demotes the active turn from Working after agentic work starts", () => {
		const optimisticUserMessage: UIMessage = {
			id: "user-optimistic",
			role: "user",
			parts: [{ type: "text", text: "Inspect the repository" }],
		};
		const persistedUserMessage: UIMessage = {
			...optimisticUserMessage,
			id: "user-persisted",
		};
		const emptyAssistantMessage: UIMessage = {
			id: streamingReasoningMessage.id,
			role: "assistant",
			parts: [],
		};
		const { rerender } = render(
			renderMessageList({
				isLoading: true,
				messages: [optimisticUserMessage, emptyAssistantMessage],
			}),
		);

		expect(screen.getByText("Thinking")).not.toBeNull();

		rerender(
			renderMessageList({
				isLoading: true,
				messages: [optimisticUserMessage, streamingToolMessage],
			}),
		);

		expect(screen.getByRole("button", { name: /^Working/ })).not.toBeNull();

		rerender(
			renderMessageList({
				isLoading: true,
				messages: [persistedUserMessage, emptyAssistantMessage],
			}),
		);

		expect(screen.getByText("Working")).not.toBeNull();
		expect(screen.queryByText("Thinking")).toBeNull();

		rerender(
			renderMessageList({
				isLoading: true,
				messages: [persistedUserMessage, streamingReasoningMessage],
			}),
		);

		expect(screen.getByRole("button", { name: /^Working/ })).not.toBeNull();
		expect(screen.getByText("Thinking")).not.toBeNull();
	});

	it("renders the generic status when no reasoning part is streaming", () => {
		render(
			<TooltipProvider>
				<MessageScrollerProvider autoScroll>
					<MessageScroller>
						<MessageScrollerViewport>
							<ChatMessageListContent
								isLoading
								messages={[
									{
										id: "assistant-1",
										role: "assistant",
										parts: [],
									},
								]}
							/>
						</MessageScrollerViewport>
					</MessageScroller>
				</MessageScrollerProvider>
			</TooltipProvider>,
		);

		expect(screen.getAllByText("Thinking")).toHaveLength(1);
	});

	it("shows the completed turn duration without an empty disclosure", () => {
		render(
			<TooltipProvider>
				<MessageScrollerProvider autoScroll>
					<MessageScroller>
						<MessageScrollerViewport>
							<ChatMessageListContent
								messages={[
									{
										id: "user-timed",
										role: "user",
										parts: [{ type: "text", text: "Answer briefly" }],
										createdAt: 1_000,
									} satisfies UIMessage & { createdAt: number },
									{
										id: "assistant-timed",
										role: "assistant",
										parts: [{ type: "text", text: "Done", state: "done" }],
										createdAt: 3_750,
									} satisfies UIMessage & { createdAt: number },
								]}
							/>
						</MessageScrollerViewport>
					</MessageScroller>
				</MessageScrollerProvider>
			</TooltipProvider>,
		);

		expect(screen.getByText("2s")).not.toBeNull();
		expect(screen.queryByRole("button", { name: /^Worked/ })).toBeNull();
		expect(screen.getByText("Worked")).not.toBeNull();
	});

	it("keeps timing a direct answer while only Thinking is visible", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const userMessage: UIMessage = {
			id: "user-direct",
			role: "user",
			parts: [{ type: "text", text: "Answer briefly" }],
		};
		const renderMessageList = (isLoading: boolean, assistant: UIMessage) => (
			<TooltipProvider>
				<MessageScrollerProvider autoScroll>
					<MessageScroller>
						<MessageScrollerViewport>
							<ChatMessageListContent
								isLoading={isLoading}
								messages={[userMessage, assistant]}
							/>
						</MessageScrollerViewport>
					</MessageScroller>
				</MessageScrollerProvider>
			</TooltipProvider>
		);
		const { rerender } = render(
			renderMessageList(true, {
				id: "assistant-direct",
				role: "assistant",
				parts: [],
			}),
		);

		expect(screen.getByText("Thinking")).not.toBeNull();
		vi.setSystemTime(4_750);
		rerender(
			renderMessageList(false, {
				id: "assistant-direct",
				role: "assistant",
				parts: [{ type: "text", text: "Done", state: "done" }],
			}),
		);

		expect(screen.getByText("Worked")).not.toBeNull();
		expect(screen.getByText("3s")).not.toBeNull();
	});

	it("reveals completed reasoning through the Thought disclosure", async () => {
		const user = userEvent.setup();

		render(
			<TooltipProvider>
				<MessageScrollerProvider autoScroll>
					<MessageScroller>
						<MessageScrollerViewport>
							<ChatMessageListContent messages={[completedReasoningMessage]} />
						</MessageScrollerViewport>
					</MessageScroller>
				</MessageScrollerProvider>
			</TooltipProvider>,
		);

		expect(screen.queryByRole("button", { name: "Thought" })).toBeNull();
		await user.click(screen.getByRole("button", { name: /^Worked/ }));
		expect(screen.queryByText(/Reviewed the current renderer/)).toBeNull();
		await user.click(screen.getByRole("button", { name: "Thought" }));
		expect(screen.getByText(/Reviewed the current renderer/)).not.toBeNull();
	});

	it("groups turn activity under one Worked disclosure even when its first assistant slot is empty", async () => {
		const user = userEvent.setup();

		render(
			<TooltipProvider>
				<MessageScrollerProvider autoScroll>
					<MessageScroller>
						<MessageScrollerViewport>
							<ChatMessageListContent
								messages={[
									assistantContinuationMessage,
									completedToolAndReasoningMessage,
								]}
							/>
						</MessageScrollerViewport>
					</MessageScroller>
				</MessageScrollerProvider>
			</TooltipProvider>,
		);

		expect(
			screen.getAllByRole("button", { name: /^Worked.*1 call/ }),
		).toHaveLength(1);
		await user.click(screen.getByRole("button", { name: /^Worked.*1 call/ }));
		expect(screen.getByRole("button", { name: "Thought" })).not.toBeNull();
		expect(screen.getByText("Explored local folder")).not.toBeNull();
	});
});
