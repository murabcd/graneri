import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
	mergeRendererChatSessionMessages,
	prepareRendererUserQuestionMessages,
	resolveActiveAssistantMessageId,
	shouldAutomaticallyContinueRendererChat,
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
	it("keeps a durable run active while local text exists between requests", () => {
		const assistantMessage = message("assistant-1", "assistant", "Complete");

		const state = resolveActiveAssistantMessageId({
			activeRun: {
				assistantMessageId: "assistant-1",
			},
			controllerMessages: [assistantMessage],
			persistedMessages: [],
		});

		expect(state).toBe("assistant-1");
	});

	it("shows server-drained follow-ups after the local controller generation completes", () => {
		const initialUser = message("user-initial", "user", "Start");
		const initialAssistant = message(
			"assistant-initial",
			"assistant",
			"Initial response",
		);
		const firstQueuedUser = message("queued-a", "user", "A");
		const firstQueuedAssistant = message(
			"assistant-a",
			"assistant",
			"Red-black trees",
		);
		const secondQueuedUser = message("queued-b", "user", "B");
		const secondQueuedAssistant = message("assistant-b", "assistant", "BRAVO");
		const thirdQueuedUser = message("queued-c", "user", "C");
		const thirdQueuedAssistant = message("assistant-c", "assistant", "CHARLIE");
		const controllerMessages = [
			initialUser,
			initialAssistant,
			firstQueuedUser,
			firstQueuedAssistant,
		];
		const persistedFirstQueuedAssistant = message(
			"assistant-a",
			"assistant",
			"Red-black",
		);
		const persistedMessages = [
			initialUser,
			initialAssistant,
			firstQueuedUser,
			persistedFirstQueuedAssistant,
			secondQueuedUser,
			secondQueuedAssistant,
			thirdQueuedUser,
			thirdQueuedAssistant,
		];

		const mergedMessages = mergeRendererChatSessionMessages({
			activeAssistantMessageId: null,
			controllerMessages,
			activeRun: null,
			persistedMessages,
		});

		expect(mergedMessages).toEqual([
			...controllerMessages,
			secondQueuedUser,
			secondQueuedAssistant,
			thirdQueuedUser,
			thirdQueuedAssistant,
		]);
	});

	it("uses the latest assistant after the latest user for active-run identity", () => {
		const state = resolveActiveAssistantMessageId({
			activeRun: {
				assistantMessageId: "run-assistant",
			},
			controllerMessages: [
				message("old-assistant", "assistant", "Old"),
				message("latest-user", "user", "Continue"),
				message("streaming-assistant", "assistant", "Partial"),
			],
			persistedMessages: [],
		});

		expect(state).toBe("streaming-assistant");
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
			activeRun: {
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

	it("keeps questionnaire outputs on the explicit continuation path", () => {
		const questionnaireMessage: UIMessage = {
			id: "assistant-question",
			role: "assistant",
			parts: [
				{ type: "step-start" },
				{
					type: "tool-request_user_input",
					toolCallId: "question-1",
					state: "output-available",
					input: {
						questions: [
							{
								id: "sources",
								question: "Which sources may I use?",
								options: [
									{ label: "Notes", description: "Use connected notes." },
									{ label: "Web", description: "Use online sources." },
								],
							},
						],
					},
					output: { answer: "Notes, Web" },
				},
			],
		};

		expect(
			shouldAutomaticallyContinueRendererChat({
				messages: [questionnaireMessage],
			}),
		).toBe(false);
	});

	it("places a persisted questionnaire last before adding its tool output", () => {
		const userMessage = message("user-1", "user", "Ask me first");
		const questionnaireMessage: UIMessage = {
			id: "assistant-question",
			role: "assistant",
			parts: [
				{
					type: "tool-request_user_input",
					toolCallId: "question-1",
					state: "input-available",
					input: {
						questions: [
							{
								id: "sources",
								question: "Which sources may I use?",
								options: [
									{ label: "Notes", description: "Use connected notes." },
									{ label: "Web", description: "Use online sources." },
								],
							},
						],
					},
				},
			],
		};

		const preparedMessages = prepareRendererUserQuestionMessages({
			decision: {
				assistantMessageId: questionnaireMessage.id,
				toolCallId: "question-1",
			},
			messages: [
				userMessage,
				questionnaireMessage,
				message("later-assistant", "assistant", "Stale local output"),
			],
		});

		expect(preparedMessages).toEqual([userMessage, questionnaireMessage]);
		expect(preparedMessages.at(-1)?.role).toBe("assistant");
	});

	it("prefers a locally resolved questionnaire over its pending durable copy", () => {
		const pendingQuestion: UIMessage = {
			id: "assistant-question",
			role: "assistant",
			parts: [
				{
					type: "tool-request_user_input",
					toolCallId: "question-1",
					state: "input-available",
					input: {
						questions: [
							{
								id: "sources",
								question: "Which sources may I use?",
								options: [
									{ label: "Notes", description: "Use connected notes." },
									{ label: "Web", description: "Use online sources." },
								],
							},
						],
					},
				},
			],
		};
		const resolvedQuestion: UIMessage = {
			...pendingQuestion,
			parts: pendingQuestion.parts.map((part) =>
				part.type === "tool-request_user_input"
					? {
							...part,
							state: "output-available" as const,
							output: { answer: "Notes, Web" },
						}
					: part,
			),
		};

		const mergedMessages = mergeRendererChatSessionMessages({
			activeAssistantMessageId: pendingQuestion.id,
			controllerMessages: [resolvedQuestion],
			activeRun: { assistantMessageId: pendingQuestion.id },
			persistedMessages: [pendingQuestion],
		});

		expect(mergedMessages).toEqual([resolvedQuestion]);
	});

	it("still auto-continues ordinary completed client tools", () => {
		const toolMessage: UIMessage = {
			id: "assistant-tool",
			role: "assistant",
			parts: [
				{ type: "step-start" },
				{
					type: "dynamic-tool",
					toolName: "read_local_file",
					toolCallId: "tool-1",
					state: "output-available",
					input: { path: "notes.md" },
					output: { text: "Notes" },
				},
			],
		};

		expect(
			shouldAutomaticallyContinueRendererChat({ messages: [toolMessage] }),
		).toBe(true);
	});
});
