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

it("keeps the turn clock through an idle handoff containing only an empty reasoning placeholder", () => {
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
	expect(result.current.turns[0].assistantTurnWorkStatus).toBe("streaming");
	rerender({ messages, isLoading: true });
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
