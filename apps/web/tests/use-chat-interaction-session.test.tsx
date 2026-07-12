import { act, renderHook } from "@testing-library/react";
import type { UIMessage } from "ai";
import * as React from "react";
import { expect, it } from "vitest";
import { useChatInteractionSession } from "../src/hooks/use-chat-interaction-session";

const createMessage = (id: string): UIMessage => ({
	id,
	role: "user",
	parts: [{ type: "text", text: id }],
});

const useTestSession = () => {
	const [messages, setMessages] = React.useState<UIMessage[]>([
		createMessage("persisted"),
	]);
	return {
		messages,
		...useChatInteractionSession({ chatId: "chat-1", setMessages }),
	};
};

it("keeps preparation pending until every lease finishes", () => {
	const { result } = renderHook(useTestSession);
	let finishFirst = () => undefined;
	let finishSecond = () => undefined;

	act(() => {
		finishFirst = result.current.beginRequestPreparation();
		finishSecond = result.current.beginRequestPreparation();
	});
	expect(result.current.isPreparingRequest).toBe(true);

	act(() => finishFirst());
	expect(result.current.isPreparingRequest).toBe(true);

	act(() => {
		finishFirst();
		finishSecond();
	});
	expect(result.current.isPreparingRequest).toBe(false);
});

it("commits, rolls back, and truncates optimistic messages atomically", () => {
	const { result } = renderHook(useTestSession);

	act(() => {
		result.current.commitOptimisticMessage(createMessage("optimistic-1"));
		result.current.commitOptimisticMessage(createMessage("optimistic-2"));
	});
	expect(result.current.messages.map((message) => message.id)).toEqual([
		"persisted",
		"optimistic-1",
		"optimistic-2",
	]);
	expect(
		result.current.localOptimisticMessages?.messages.map(
			(message) => message.id,
		),
	).toEqual(["optimistic-1", "optimistic-2"]);

	act(() => result.current.rollbackOptimisticMessage("optimistic-2"));
	expect(result.current.messages.map((message) => message.id)).toEqual([
		"persisted",
		"optimistic-1",
	]);

	act(() => result.current.truncateMessagesFrom("optimistic-1"));
	expect(result.current.messages.map((message) => message.id)).toEqual([
		"persisted",
	]);
	expect(result.current.localOptimisticMessages?.messages).toEqual([]);
});
