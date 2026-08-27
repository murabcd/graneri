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

it("keeps preparation pending until every prepared operation finishes", async () => {
	const { result } = renderHook(useTestSession);
	let finishFirst = () => undefined;
	let finishSecond = () => undefined;
	const firstOperation = new Promise<void>((resolve) => {
		finishFirst = resolve;
	});
	const secondOperation = new Promise<void>((resolve) => {
		finishSecond = resolve;
	});
	let firstRequest: Promise<void> | undefined;
	let secondRequest: Promise<void> | undefined;

	act(() => {
		firstRequest = result.current.runPreparedRequest(() => firstOperation);
		secondRequest = result.current.runPreparedRequest(() => secondOperation);
	});
	expect(result.current.isPreparingRequest).toBe(true);

	await act(async () => {
		finishFirst();
		await firstRequest;
	});
	expect(result.current.isPreparingRequest).toBe(true);

	await act(async () => {
		finishSecond();
		await secondRequest;
	});
	expect(result.current.isPreparingRequest).toBe(false);
});

it("releases preparation state when a prepared operation rejects", async () => {
	const { result } = renderHook(useTestSession);
	const failure = new Error("request failed");

	await act(async () => {
		await expect(
			result.current.runPreparedRequest(async () => {
				throw failure;
			}),
		).rejects.toBe(failure);
	});

	expect(result.current.isPreparingRequest).toBe(false);
});

it("commits, rolls back, and branches optimistic messages atomically", () => {
	const { result } = renderHook(useTestSession);

	act(() => {
		result.current.commitOptimisticMessage({
			message: createMessage("optimistic-1"),
		});
		result.current.commitOptimisticMessage({
			message: createMessage("optimistic-2"),
		});
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

	act(() => result.current.branchMessagesFrom({ messageId: "optimistic-1" }));
	expect(result.current.messages.map((message) => message.id)).toEqual([
		"persisted",
	]);
	expect(result.current.localOptimisticMessages?.messages).toEqual([]);
});
