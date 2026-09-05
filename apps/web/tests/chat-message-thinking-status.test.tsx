import { act, cleanup, render, screen } from "@testing-library/react";
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

const getRenderedParagraph = (text: string) =>
	screen.getByText(
		(_content, element) =>
			element?.tagName === "P" && element.textContent === text,
	);

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
	it("removes the disclosure when working details become empty or hidden", () => {
		const { rerender } = render(
			renderMessageList({
				isLoading: true,
				messages: [streamingReasoningMessage],
			}),
		);
		expect(screen.getByRole("button", { name: /^Working/ })).not.toBeNull();
		for (const text of ["", "   "]) {
			rerender(
				renderMessageList({
					messages: [
						{
							id: streamingReasoningMessage.id,
							role: "assistant",
							metadata: { workDurationMs: 19_000 },
							parts: [
								{ type: "reasoning", text, state: "done" },
								{
									type: "dynamic-tool",
									toolName: "internal_transport",
									toolCallId: "hidden",
									state: "output-available",
									input: {},
									output: {},
								},
								{ type: "text", text: "Answer", state: "done" },
							],
						},
					],
				}),
			);
			expect(screen.queryByRole("button", { name: /^Worked/ })).toBeNull();
			const group = screen
				.getByText("Worked")
				.closest("[data-assistant-work-group]");
			expect(group?.querySelector("svg")).toBeNull();
			expect(group?.querySelector("[aria-expanded]")).toBeNull();
			expect(screen.getByText("19s")).not.toBeNull();
		}
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("keeps active turn activity inside one expanded Working group and collapses it on completion", async () => {
		const user = userEvent.setup();
		const { rerender } = render(
			renderMessageList({
				isLoading: true,
				messages: [{ id: "assistant-1", role: "assistant", parts: [] }],
			}),
		);

		expect(screen.getByText("Working")).not.toBeNull();
		expect(screen.queryByText("Thinking")).toBeNull();

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
		expect(
			screen.getByRole("button", { name: /^Working for / }),
		).not.toBeNull();
		expect(screen.getAllByText("Thinking")).toHaveLength(1);

		rerender(
			renderMessageList({
				isLoading: true,
				messages: [completedTurnWorkMessage, assistantContinuationMessage],
			}),
		);

		expect(
			screen
				.getByRole("button", { name: /^Working/ })
				.getAttribute("aria-expanded"),
		).toBe("true");
		expect(screen.getByText("Explored local folder")).not.toBeNull();
		expect(screen.queryByText("Thinking")).toBeNull();
		expect(screen.getByRole("button", { name: "Thought" })).not.toBeNull();

		rerender(
			renderMessageList({
				messages: [completedTurnWorkMessage, assistantContinuationMessage],
			}),
		);

		expect(
			screen
				.getByRole("button", { name: /^Worked/ })
				.getAttribute("aria-expanded"),
		).toBe("false");
		expect(
			screen.getByRole("button", { name: "Worked", exact: true }),
		).not.toBeNull();
		expect(screen.queryByRole("button", { name: "Thought" })).toBeNull();
		await user.click(screen.getByRole("button", { name: /^Worked/ }));
		expect(screen.getByRole("button", { name: "Thought" })).not.toBeNull();
	});

	it("preserves commentary and tool calls inside Worked in source order before the final answer", async () => {
		const user = userEvent.setup();
		const message: UIMessage = {
			id: "assistant-ordered",
			role: "assistant",
			metadata: { workDurationMs: 123 },
			parts: [
				{
					type: "text",
					text: "I’ll inspect the renderer.",
					state: "done",
					providerMetadata: {
						openai: { itemId: "commentary-1", phase: "commentary" },
					},
				},
				{
					type: "tool-run_local_command",
					toolCallId: "call-command",
					state: "output-available",
					input: { command: "rg renderer" },
					output: { stdout: "message-list.tsx" },
				},
				{
					type: "text",
					text: "The renderer flattens the event stream.",
					state: "done",
					providerMetadata: {
						openai: { itemId: "commentary-2", phase: "commentary" },
					},
				},
				{
					type: "tool-search_local_files",
					toolCallId: "call-search",
					state: "output-available",
					input: { query: "message parts" },
					output: { matches: [] },
				},
				{
					type: "text",
					text: "The ordered stream is now preserved.",
					state: "done",
					providerMetadata: {
						openai: { itemId: "final-1", phase: "final_answer" },
					},
				},
			],
		};

		render(renderMessageList({ messages: [message] }));
		const worked = screen.getByRole("button", { name: /^Worked/ });
		expect(worked.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("I’ll inspect the renderer.")).toBeNull();
		expect(
			screen.getByText("The ordered stream is now preserved."),
		).not.toBeNull();
		await user.click(worked);
		expect(screen.getAllByText(/\d+ms$/)).toHaveLength(1);

		const orderedNodes = [
			worked,
			screen.getByText("I’ll inspect the renderer."),
			screen.getByText("Explored local folder"),
			screen.getByText("The renderer flattens the event stream."),
			screen.getByText("Searched local files"),
			screen.getByText("The ordered stream is now preserved."),
		];

		for (let index = 0; index < orderedNodes.length - 1; index += 1) {
			const currentNode = orderedNodes.at(index);
			const nextNode = orderedNodes.at(index + 1);
			if (!currentNode || !nextNode) {
				throw new Error("Expected adjacent rendered activity nodes");
			}
			expect(currentNode.compareDocumentPosition(nextNode)).toBe(
				Node.DOCUMENT_POSITION_FOLLOWING,
			);
		}
	});

	it("only appends activity while Working and collapses once when final_answer starts", async () => {
		const user = userEvent.setup();
		const activityParts: UIMessage["parts"] = [
			{
				type: "text",
				text: "I’ll inspect the first source.",
				state: "done",
				providerMetadata: {
					openai: { itemId: "commentary-append-1", phase: "commentary" },
				},
			},
			{
				type: "tool-run_local_command",
				toolCallId: "call-append-1",
				state: "output-available",
				input: { command: "pwd" },
				output: { stdout: "/workspace" },
			},
			{
				type: "text",
				text: "The first source is clear; I’ll inspect the second.",
				state: "streaming",
				providerMetadata: {
					openai: { itemId: "commentary-append-2", phase: "commentary" },
				},
			},
		];
		const renderActivity = (parts: UIMessage["parts"]) =>
			renderMessageList({
				isLoading: true,
				messages: [{ id: "assistant-append", role: "assistant", parts }],
			});
		const { rerender } = render(renderActivity(activityParts.slice(0, 1)));

		expect(
			screen
				.getByRole("button", { name: /^Working/ })
				.getAttribute("aria-expanded"),
		).toBe("true");
		expect(screen.getByText("I’ll inspect the first source.")).not.toBeNull();

		rerender(renderActivity(activityParts));
		expect(screen.getByText("I’ll inspect the first source.")).not.toBeNull();
		expect(screen.getByText("Explored local folder")).not.toBeNull();
		expect(
			getRenderedParagraph(
				"The first source is clear; I’ll inspect the second.",
			),
		).not.toBeNull();

		const finalPart: UIMessage["parts"][number] = {
			type: "text",
			text: "Here is the final answer.",
			state: "streaming",
			providerMetadata: {
				openai: { itemId: "final-append", phase: "final_answer" },
			},
		};
		rerender(renderActivity([...activityParts, finalPart]));

		const worked = screen.getByRole("button", { name: /^Worked/ });
		expect(worked.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("I’ll inspect the first source.")).toBeNull();
		expect(screen.queryByText("Explored local folder")).toBeNull();
		expect(getRenderedParagraph("Here is the final answer.")).not.toBeNull();

		await user.click(worked);
		expect(screen.getByText("I’ll inspect the first source.")).not.toBeNull();
		expect(screen.getByText("Explored local folder")).not.toBeNull();
		expect(
			getRenderedParagraph(
				"The first source is clear; I’ll inspect the second.",
			),
		).not.toBeNull();
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

		expect(screen.getByText("Working")).not.toBeNull();
		expect(screen.queryByText("Thinking")).toBeNull();

		rerender(
			renderMessageList({
				isLoading: true,
				messages: [optimisticUserMessage, streamingToolMessage],
			}),
		);

		expect(screen.getByText("Working")).not.toBeNull();
		expect(screen.getByText("Exploring local folder")).not.toBeNull();

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

		expect(screen.getByText("Working")).not.toBeNull();
		expect(screen.getByText("Thinking")).not.toBeNull();
	});

	it("keeps the same Working row when the pending assistant reconciles", () => {
		const userMessage: UIMessage = {
			id: "user-pending-assistant",
			role: "user",
			parts: [{ type: "text", text: "Inspect the renderer" }],
		};
		const { rerender } = render(
			renderMessageList({
				isLoading: true,
				messages: [userMessage],
			}),
		);
		const workingGroup = screen
			.getByText("Working")
			.closest("[data-assistant-work-group]");
		expect(workingGroup).not.toBeNull();

		rerender(
			renderMessageList({
				isLoading: true,
				messages: [
					userMessage,
					{
						id: "assistant-reconciled",
						role: "assistant",
						parts: [],
					},
				],
			}),
		);

		expect(
			screen.getByText("Working").closest("[data-assistant-work-group]"),
		).toBe(workingGroup);
	});

	it("keeps Working mounted across the request-to-run handoff", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const userMessage: UIMessage = {
			id: "user-request-run-handoff",
			role: "user",
			parts: [{ type: "text", text: "Inspect the renderer" }],
		};
		const { rerender } = render(
			renderMessageList({
				isLoading: true,
				messages: [userMessage],
			}),
		);
		act(() => vi.advanceTimersByTime(2_200));
		const workingGroup = screen
			.getByText("Working")
			.closest("[data-assistant-work-group]");
		expect(workingGroup).not.toBeNull();
		expect(screen.getByText("2s")).not.toBeNull();

		rerender(renderMessageList({ messages: [userMessage] }));
		expect(
			screen.getByText("Working").closest("[data-assistant-work-group]"),
		).toBe(workingGroup);
		expect(screen.getByText("2s")).not.toBeNull();

		const persistedAssistantMessage: UIMessage = {
			id: "assistant-request-run-handoff",
			role: "assistant",
			parts: [],
		};
		rerender(
			renderMessageList({
				messages: [userMessage, persistedAssistantMessage],
			}),
		);
		expect(
			screen.getByText("Working").closest("[data-assistant-work-group]"),
		).toBe(workingGroup);
		expect(screen.getByText("2s")).not.toBeNull();

		rerender(
			renderMessageList({
				isLoading: true,
				messages: [userMessage, persistedAssistantMessage],
			}),
		);
		expect(
			screen.getByText("Working").closest("[data-assistant-work-group]"),
		).toBe(workingGroup);
	});

	it("keeps the same activity row when Working becomes Worked", () => {
		const assistantMessage: UIMessage = {
			id: "assistant-worked-transition",
			role: "assistant",
			parts: [],
		};
		const { rerender } = render(
			renderMessageList({
				isLoading: true,
				messages: [assistantMessage],
			}),
		);
		const workingGroup = screen
			.getByText("Working")
			.closest("[data-assistant-work-group]");
		expect(workingGroup).not.toBeNull();

		rerender(
			renderMessageList({
				messages: [
					{
						...assistantMessage,
						parts: [
							{
								type: "text",
								text: "Done",
								state: "done",
								providerMetadata: {
									openai: { itemId: "final-worked", phase: "final_answer" },
								},
							},
						],
					},
				],
			}),
		);

		expect(
			screen.getByText("Worked").closest("[data-assistant-work-group]"),
		).toBe(workingGroup);
	});

	it("does not reserve answer spacing before the answer exists", () => {
		const assistantMessage: UIMessage = {
			id: "assistant-layout-lifecycle",
			role: "assistant",
			parts: [],
		};
		const { rerender } = render(
			renderMessageList({
				isLoading: true,
				messages: [assistantMessage],
			}),
		);
		const workingGroup = screen
			.getByText("Working")
			.closest("[data-assistant-work-group]");
		expect(workingGroup).not.toBeNull();
		expect(
			document.querySelector(
				'[data-chat-message-scroll-row="assistant-layout-lifecycle"]',
			),
		).toBeNull();

		rerender(
			renderMessageList({
				messages: [
					{
						...assistantMessage,
						parts: [
							{
								type: "text",
								text: "The answer is ready.",
								state: "done",
								providerMetadata: {
									openai: { itemId: "layout-final", phase: "final_answer" },
								},
							},
						],
					},
				],
			}),
		);

		expect(
			screen.getByText("Worked").closest("[data-assistant-work-group]"),
		).toBe(workingGroup);
		expect(getRenderedParagraph("The answer is ready.")).not.toBeNull();
		expect(
			document.querySelector(
				'[data-chat-message-scroll-row="assistant-layout-lifecycle"]',
			),
		).not.toBeNull();
	});

	it("keeps one uninterrupted turn timer when optimistic message identity changes", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const assistantMessage: UIMessage = {
			id: "assistant-timer",
			role: "assistant",
			parts: [],
		};
		const { rerender } = render(
			renderMessageList({
				isLoading: true,
				messages: [
					{
						id: "user-optimistic-timer",
						role: "user",
						parts: [{ type: "text", text: "Inspect twice" }],
					},
					assistantMessage,
				],
			}),
		);

		act(() => vi.advanceTimersByTime(3_200));
		expect(screen.getByText("3s")).not.toBeNull();

		rerender(
			renderMessageList({
				isLoading: true,
				messages: [
					{
						id: "user-persisted-timer",
						role: "user",
						parts: [{ type: "text", text: "Inspect twice" }],
					},
					{
						...assistantMessage,
						parts: [
							{
								type: "text",
								text: "I’ll inspect the first source.",
								state: "done",
								providerMetadata: {
									openai: { itemId: "commentary-timer", phase: "commentary" },
								},
							},
						],
					},
				],
			}),
		);

		expect(screen.getByText("3s")).not.toBeNull();
		act(() => vi.advanceTimersByTime(1_000));
		expect(screen.getByText("4s")).not.toBeNull();

		rerender(
			renderMessageList({
				messages: [
					{
						id: "user-persisted-timer",
						role: "user",
						parts: [{ type: "text", text: "Inspect twice" }],
					},
					{
						...assistantMessage,
						metadata: { workDurationMs: 4200 },
						parts: [
							{
								type: "text",
								text: "Done",
								state: "done",
								providerMetadata: {
									openai: { itemId: "final-timer", phase: "final_answer" },
								},
							},
						],
					},
				],
			}),
		);

		expect(screen.getByText("Worked")).not.toBeNull();
		expect(screen.getByText("4s")).not.toBeNull();
	});

	it("renders Working when no stream part has arrived", () => {
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

		expect(screen.getAllByText("Working")).toHaveLength(1);
		expect(screen.queryByText("Thinking")).toBeNull();
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
										metadata: { workDurationMs: 2750 },
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

	it("keeps timing a direct answer while Working is visible", () => {
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

		expect(screen.getByText("Working")).not.toBeNull();
		vi.setSystemTime(4_750);
		rerender(
			renderMessageList(false, {
				id: "assistant-direct",
				role: "assistant",
				parts: [{ type: "text", text: "Done", state: "done" }],
				metadata: { workDurationMs: 3750 },
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
		expect(screen.getByRole("button", { name: "Thought" })).not.toBeNull();
		expect(screen.queryByText(/Reviewed the current renderer/)).toBeNull();
		await user.click(screen.getByRole("button", { name: "Thought" }));
		expect(screen.getByText(/Reviewed the current renderer/)).not.toBeNull();
	});

	it("renders one collapsed Worked group after continuation activity", async () => {
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

		expect(screen.getAllByRole("button", { name: /^Worked/ })).toHaveLength(1);
		expect(screen.queryByRole("button", { name: "Thought" })).toBeNull();
		await user.click(screen.getByRole("button", { name: /^Worked/ }));
		expect(screen.getByRole("button", { name: "Thought" })).not.toBeNull();
		expect(screen.getByText("Explored local folder")).not.toBeNull();
	});

	it("does not render an inline sources disclosure in the chat message", () => {
		render(
			renderMessageList({
				messages: [
					{
						id: "assistant-with-source",
						role: "assistant",
						parts: [
							{
								type: "text",
								text: "Source-backed answer.",
								state: "done",
								providerMetadata: {
									openai: { itemId: "final-source", phase: "final_answer" },
								},
							},
							{
								type: "source-url",
								sourceId: "source-1",
								url: "https://example.com/source",
								title: "Example source",
							},
						],
					},
				],
			}),
		);

		expect(screen.getByText("Source-backed answer.")).not.toBeNull();
		expect(screen.queryByRole("button", { name: /sources/i })).toBeNull();
	});
});
