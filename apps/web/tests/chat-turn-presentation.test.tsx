import { act, cleanup, renderHook } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, expect, it, vi } from "vitest";
import { useChatTurnPresentation } from "../src/components/chat/use-chat-turn-presentation";

const user: UIMessage = {
	id: "user",
	role: "user",
	parts: [{ type: "text", text: "Search notes" }],
};
const commentary: UIMessage["parts"][number] = {
	type: "text",
	text: "Searching now.",
	providerMetadata: { openai: { phase: "commentary" } },
};
const tool: UIMessage["parts"][number] = {
	type: "tool-search_notes",
	toolCallId: "search-1",
	state: "output-available",
	input: { query: "design engineering" },
	output: { notes: [] },
};
const assistant = (parts: UIMessage["parts"]): UIMessage => ({
	id: "assistant",
	role: "assistant",
	parts,
});
const usePresentation = (messages: UIMessage[]) =>
	useChatTurnPresentation({
		messages,
		isLoading: true,
		scrollAnchorUserMessages: false,
	});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

it("replaces a message's activity snapshot when inserted parts shift source positions", () => {
	const { result, rerender } = renderHook(usePresentation, {
		initialProps: [user, assistant([commentary, tool])],
	});
	const prefix: UIMessage["parts"] = [
		{ type: "reasoning", text: "Checking scope.", state: "done" },
		{ ...commentary, text: "Loading the available search tool." },
	];
	rerender([user, assistant([...prefix, commentary, tool])]);
	const units = result.current.turns[0].assistantTurnActivityUnits;
	expect(units.map((unit) => unit.sourceIndex)).toEqual([0, 1, 2, 3]);
	expect(
		units
			.filter((unit) => unit.kind === "commentary")
			.map((unit) => unit.part.text),
	).toEqual(["Loading the available search tool.", "Searching now."]);
	expect(
		units
			.flatMap((unit) => (unit.kind === "activity" ? unit.parts : []))
			.filter((part) => part.type === "tool-search_notes"),
	).toHaveLength(1);
});

it("retains missing continuation messages while replacing snapshots for present messages", () => {
	const first = assistant([commentary, tool]);
	const nextCommentary = { ...commentary, text: "Continuing the search." };
	const second: UIMessage = {
		...assistant([nextCommentary]),
		id: "continuation",
	};
	const { result, rerender } = renderHook(usePresentation, {
		initialProps: [user, first, second],
	});
	rerender([
		user,
		{
			...second,
			parts: [
				{ type: "reasoning", text: "Next", state: "done" },
				nextCommentary,
			],
		},
	]);
	expect(
		result.current.turns[0].assistantTurnActivityUnits.map((unit) => [
			unit.messageId,
			unit.sourceIndex,
		]),
	).toEqual([
		["assistant", 0],
		["assistant", 1],
		["continuation", 0],
		["continuation", 1],
	]);
});

it("ends Working when a run stops with only an empty reasoning placeholder", () => {
	vi.useFakeTimers();
	vi.setSystemTime(1000);
	const { result, rerender } = renderHook(
		(props: { messages: UIMessage[]; isLoading: boolean }) =>
			useChatTurnPresentation({ ...props, scrollAnchorUserMessages: false }),
		{ initialProps: { messages: [user], isLoading: true } },
	);
	act(() => vi.advanceTimersByTime(5000));
	const messages = [
		user,
		assistant([{ type: "reasoning", text: "", state: "streaming" }]),
	];
	rerender({ messages, isLoading: false });
	expect(result.current.turns[0].assistantTurnWorkStatus).toBe("ready");
	expect(result.current.turns[0].assistantTurnStartedAt).toBe(1000);
});

it("retains complete activity while a shorter hydration snapshot catches up", () => {
	const message = assistant([
		{ type: "reasoning", text: "Checking scope.", state: "done" },
		commentary,
		tool,
	]);
	const { result, rerender } = renderHook(usePresentation, {
		initialProps: [user, message],
	});
	const complete = result.current.turns[0].assistantTurnActivityUnits;
	rerender([
		user,
		assistant([{ type: "reasoning", text: "", state: "streaming" }]),
	]);
	expect(result.current.turns[0].assistantTurnActivityUnits).toEqual(complete);
	rerender([user, assistant([])]);
	expect(result.current.turns[0].assistantTurnActivityUnits).toEqual(complete);
	rerender([
		user,
		assistant([...message.parts, { ...commentary, text: "Search complete." }]),
	]);
	expect(result.current.turns[0].assistantTurnActivityUnits).toHaveLength(4);
});

it("starts fresh activity for an appended follow-up while preserving the pending request clock handoff", () => {
	vi.useFakeTimers();
	vi.setSystemTime(1000);
	const previous = [user, assistant([commentary, tool])];
	const { result, rerender } = renderHook(usePresentation, {
		initialProps: previous,
	});
	act(() => vi.advanceTimersByTime(3000));
	const followUp: UIMessage = { ...user, id: "follow-up" };
	rerender([...previous, followUp]);
	expect(result.current.turns.at(-1)?.assistantTurnActivityUnits).toEqual([]);
	expect(result.current.turns.at(-1)?.assistantTurnStartedAt).toBe(4000);
	const current: UIMessage = {
		...assistant([commentary]),
		id: "follow-up-assistant",
	};
	rerender([...previous, followUp, current]);
	expect(
		result.current.turns
			.at(-1)
			?.assistantTurnActivityUnits.map((unit) => unit.messageId),
	).toEqual([current.id]);
	expect(result.current.turns.at(-1)?.assistantTurnStartedAt).toBe(4000);
});

it("does not carry deleted turn activity into the remaining completed turn", () => {
	const first = [user, assistant([commentary])];
	const second: UIMessage[] = [
		{ ...user, id: "second-user" },
		{ ...assistant([tool]), id: "second-assistant" },
	];
	const { result, rerender } = renderHook(
		(messages: UIMessage[]) =>
			useChatTurnPresentation({
				messages,
				isLoading: false,
				scrollAnchorUserMessages: false,
			}),
		{ initialProps: [...first, ...second] },
	);
	rerender(first);
	expect(
		result.current.turns[0].assistantTurnActivityUnits.map(
			(unit) => unit.messageId,
		),
	).toEqual(["assistant"]);
});
