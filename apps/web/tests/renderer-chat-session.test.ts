import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
	mergeRendererChatSessionMessages,
	resolveRendererChatRunState,
} from "../src/lib/renderer-chat-session";

const message = (
	id: string,
	role: "assistant" | "user",
	text: string,
): UIMessage => ({
	id,
	parts: [{ text, type: "text" }],
	role,
});

describe("renderer chat session", () => {
	it("hides a stale durable run after its assistant message completes locally", () => {
		const assistantMessage = message("assistant-1", "assistant", "Complete");

		const state = resolveRendererChatRunState({
			activeRun: {
				assistantMessageId: "assistant-1",
				status: "running",
			},
			controllerMessages: [assistantMessage],
			isAiRequestPending: false,
			persistedMessages: [],
		});

		expect(state).toEqual({
			activeAssistantMessageId: null,
			displayActiveRun: null,
			hasLocallyCompletedAssistantMessage: true,
		});
	});

	it("uses the latest assistant after the latest user for active-run identity", () => {
		const state = resolveRendererChatRunState({
			activeRun: {
				assistantMessageId: "run-assistant",
				status: "running",
			},
			controllerMessages: [
				message("old-assistant", "assistant", "Old"),
				message("latest-user", "user", "Continue"),
				message("streaming-assistant", "assistant", "Partial"),
			],
			isAiRequestPending: true,
			persistedMessages: [],
		});

		expect(state.activeAssistantMessageId).toBe("streaming-assistant");
		expect(state.displayActiveRun).not.toBeNull();
	});

	it("places queued persisted input before the replacement assistant after steer", () => {
		const persistedUser = message("queued-user", "user", "Steer");
		const activeAssistant = message(
			"replacement-assistant",
			"assistant",
			"Replacement",
		);

		const mergedMessages = mergeRendererChatSessionMessages({
			activeAssistantMessageId: activeAssistant.id,
			controllerMessages: [activeAssistant],
			displayActiveRun: {
				assistantMessageId: "run-assistant",
				interruptedAssistantMessageIds: ["interrupted-assistant"],
			},
			persistedMessages: [persistedUser],
		});

		expect(mergedMessages.map(({ id }) => id)).toEqual([
			"queued-user",
			"replacement-assistant",
		]);
	});
});
