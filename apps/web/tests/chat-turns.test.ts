import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { groupMessagesIntoTurns } from "../src/lib/chat-turns";

const createMessage = ({
	id,
	role,
}: {
	id: string;
	role: "assistant" | "user";
}): UIMessage => ({
	id,
	role,
	parts: [],
});

describe("groupMessagesIntoTurns", () => {
	it("keeps assistant-only and user-led turns non-empty and ordered", () => {
		const leadingAssistant = createMessage({
			id: "assistant-leading",
			role: "assistant",
		});
		const user = createMessage({ id: "user-1", role: "user" });
		const assistant = createMessage({ id: "assistant-1", role: "assistant" });
		const messages = [leadingAssistant, user, assistant];

		expect(groupMessagesIntoTurns(messages)).toEqual([
			[leadingAssistant],
			[user, assistant],
		]);
	});
});
