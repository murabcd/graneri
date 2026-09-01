import { renderHook } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatTurnPresentation } from "@/components/chat/use-chat-turn-presentation";

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
	id: "assistant-1",
	role: "assistant",
	parts: [],
};

const workingAssistantMessage: UIMessage = {
	id: emptyAssistantMessage.id,
	role: "assistant",
	parts: [
		{
			type: "tool-run_local_command",
			toolCallId: "call-1",
			state: "input-available",
			input: { command: "pwd" },
		},
	],
};

const renderPresentation = ({
	isLoading,
	messages,
}: {
	isLoading: boolean;
	messages: UIMessage[];
}) =>
	useChatTurnPresentation({
		isLoading,
		messages,
		scrollAnchorUserMessages: true,
	});

describe("active turn presentation", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps work monotonic while optimistic and persisted ids reconcile", () => {
		const { result, rerender } = renderHook(renderPresentation, {
			initialProps: {
				isLoading: true,
				messages: [optimisticUserMessage, emptyAssistantMessage],
			},
		});

		expect(result.current.turns[0]?.assistantTurnActivityUnits).toHaveLength(0);

		rerender({
			isLoading: true,
			messages: [optimisticUserMessage, workingAssistantMessage],
		});
		expect(result.current.turns[0]?.assistantTurnActivityUnits).toHaveLength(1);

		rerender({
			isLoading: true,
			messages: [persistedUserMessage, emptyAssistantMessage],
		});
		expect(result.current.turns[0]?.assistantTurnActivityUnits).toHaveLength(1);
		expect(result.current.turns[0]?.assistantTurnWorkStatus).toBe("streaming");
	});

	it("starts a fresh presentation clock after the previous run completes", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const { result, rerender } = renderHook(renderPresentation, {
			initialProps: {
				isLoading: true,
				messages: [optimisticUserMessage, emptyAssistantMessage],
			},
		});

		expect(result.current.turns[0]?.assistantTurnStartedAt).toBe(1_000);

		rerender({
			isLoading: false,
			messages: [
				optimisticUserMessage,
				{
					...emptyAssistantMessage,
					parts: [{ type: "text", text: "Done", state: "done" }],
				},
			],
		});

		vi.setSystemTime(5_000);
		rerender({
			isLoading: true,
			messages: [
				optimisticUserMessage,
				emptyAssistantMessage,
				{
					id: "user-2",
					role: "user",
					parts: [{ type: "text", text: "Continue" }],
				},
				{
					id: "assistant-2",
					role: "assistant",
					parts: [],
				},
			],
		});

		expect(result.current.turns[1]?.assistantTurnStartedAt).toBe(5_000);
	});
});
