import { describe, expect, it } from "vitest";
import {
	createHostedRequestUserInputTool,
	getHostedUserQuestionRequest,
	resolveHostedUserQuestionMessage,
} from "../src/hosted-user-question.mjs";

const questionMessage = {
	id: "assistant-1",
	role: "assistant" as const,
	parts: [
		{
			type: "tool-request_user_input" as const,
			toolCallId: "question-1",
			state: "input-available" as const,
			input: {
				question: "Which notes should I search?",
				responseType: "text" as const,
			},
		},
	],
};

describe("hosted user questions", () => {
	it("defines a client-resolved question tool", () => {
		const questionTool = createHostedRequestUserInputTool();

		expect(questionTool.execute).toBeUndefined();
		expect(questionTool.metadata).toMatchObject({
			ui: { running: "Waiting for your answer" },
		});
	});

	it("detects and resolves the exact pending question", () => {
		const decision = getHostedUserQuestionRequest(questionMessage);
		if (!decision) {
			throw new Error("Expected a pending user question.");
		}

		expect(decision).toEqual({
			type: "user_question",
			assistantMessageId: "assistant-1",
			toolCallId: "question-1",
			question: "Which notes should I search?",
			responseType: "text",
		});
		expect(
			resolveHostedUserQuestionMessage({
				message: questionMessage,
				decision,
			}),
		).toMatchObject({
			parts: [
				{
					state: "output-available",
					output: { answered: true },
				},
			],
		});
	});

	it("rejects a pending decision that does not match stored input", () => {
		expect(
			resolveHostedUserQuestionMessage({
				message: questionMessage,
				decision: {
					type: "user_question",
					assistantMessageId: "assistant-1",
					toolCallId: "question-1",
					question: "A different question",
					responseType: "text",
				},
			}),
		).toBeNull();
	});

	it("rejects multiple questions in one step", () => {
		const message = {
			...questionMessage,
			parts: [
				...questionMessage.parts,
				{
					type: "tool-request_user_input" as const,
					toolCallId: "question-2",
					state: "input-available" as const,
					input: {
						question: "Which date range should I use?",
						responseType: "text" as const,
					},
				},
			],
		};
		expect(() => getHostedUserQuestionRequest(message)).toThrow(
			"multiple user questions",
		);
	});

	it("preserves bounded choices and their consequence in the pending decision", () => {
		const decision = getHostedUserQuestionRequest({
			id: "assistant-choice",
			role: "assistant",
			parts: [
				{
					type: "tool-request_user_input",
					toolCallId: "question-choice",
					state: "input-available",
					input: {
						question: "Which scope should I use?",
						responseType: "choice",
						consequence: "This controls the search scope.",
						options: [
							{ label: "Current project" },
							{ label: "All projects", description: "Search everything." },
						],
					},
				},
			],
		});

		expect(decision).toMatchObject({
			type: "user_question",
			responseType: "choice",
			consequence: "This controls the search scope.",
			options: [
				{ label: "Current project" },
				{ label: "All projects", description: "Search everything." },
			],
		});
	});
});
