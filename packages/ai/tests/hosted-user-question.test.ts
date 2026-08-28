import { describe, expect, it } from "vitest";
import { CHAT_MODE } from "../src/chat-mode.mjs";
import {
	createHostedUserQuestionTools,
	getHostedUserQuestionAnswer,
	getHostedUserQuestionRequest,
	isHostedUserQuestionAnswerMessage,
	resolveHostedUserQuestionMessage,
} from "../src/hosted-user-question.mjs";

const questions = [
	{
		id: "scope",
		question: "Which notes should I search?",
		options: [
			{ label: "Current note", description: "Use only the current note." },
			{ label: "All notes", description: "Use all available notes." },
		],
	},
];

const questionMessage = {
	id: "assistant-1",
	role: "assistant" as const,
	parts: [
		{
			type: "tool-request_user_input" as const,
			toolCallId: "question-1",
			state: "input-available" as const,
			input: { questions },
		},
	],
};

describe("hosted user questions", () => {
	it("defines a client-resolved questionnaire tool", () => {
		const questionTool = createHostedUserQuestionTools(
			CHAT_MODE.PLAN,
		).request_user_input;

		expect(questionTool?.execute).toBeUndefined();
		expect(questionTool?.metadata).toMatchObject({
			ui: { running: "Waiting for your answer" },
		});
	});

	it("exposes questionnaires only in Plan mode", () => {
		expect(createHostedUserQuestionTools(CHAT_MODE.DEFAULT)).toEqual({});
		expect(createHostedUserQuestionTools(CHAT_MODE.PLAN)).toHaveProperty(
			"request_user_input",
		);
	});

	it("detects and resolves the exact pending questionnaire", () => {
		const decision = getHostedUserQuestionRequest(questionMessage);
		if (!decision) {
			throw new Error("Expected a pending user question.");
		}

		expect(decision).toEqual({
			type: "user_question",
			assistantMessageId: "assistant-1",
			toolCallId: "question-1",
			questions,
		});
		const resolvedMessage = resolveHostedUserQuestionMessage({
			message: questionMessage,
			decision,
			answer: "> Which notes should I search?\nAll notes",
		});
		expect(resolvedMessage).toMatchObject({
			parts: [
				{
					state: "output-available",
					output: {
						answer: "> Which notes should I search?\nAll notes",
					},
				},
			],
		});
		if (!resolvedMessage) {
			throw new Error("Expected the question to resolve.");
		}
		expect(
			getHostedUserQuestionAnswer({
				message: resolvedMessage,
				decision,
			}),
		).toBe("> Which notes should I search?\nAll notes");
		expect(isHostedUserQuestionAnswerMessage(resolvedMessage)).toBe(true);
		expect(
			isHostedUserQuestionAnswerMessage({
				...resolvedMessage,
				parts: resolvedMessage.parts.map((part) =>
					part.type === "tool-request_user_input"
						? { ...part, output: { answer: "   " } }
						: part,
				),
			}),
		).toBe(false);
	});

	it("rejects a pending decision that does not match stored input", () => {
		expect(
			resolveHostedUserQuestionMessage({
				message: questionMessage,
				answer: "All notes",
				decision: {
					type: "user_question",
					assistantMessageId: "assistant-1",
					toolCallId: "question-1",
					questions: [{ ...questions[0], question: "A different question" }],
				},
			}),
		).toBeNull();
	});

	it("rejects multiple questionnaire tools in one step", () => {
		const message = {
			...questionMessage,
			parts: [
				...questionMessage.parts,
				{
					type: "tool-request_user_input" as const,
					toolCallId: "question-2",
					state: "input-available" as const,
					input: { questions },
				},
			],
		};
		expect(() => getHostedUserQuestionRequest(message)).toThrow(
			"multiple user questions",
		);
	});

	it("preserves one to three described single-choice questions", () => {
		const decision = getHostedUserQuestionRequest({
			id: "assistant-questionnaire",
			role: "assistant",
			parts: [
				{
					type: "tool-request_user_input",
					toolCallId: "questionnaire-1",
					state: "input-available",
					input: {
						questions: [
							...questions,
							{
								id: "sources",
								question: "Which sources may I use?",
								options: [
									{ label: "Notes", description: "Use connected notes." },
									{ label: "Files", description: "Use workspace files." },
									{ label: "Web", description: "Use online sources." },
								],
							},
						],
					},
				},
			],
		});

		expect(decision?.questions).toEqual([
			...questions,
			{
				id: "sources",
				question: "Which sources may I use?",
				options: [
					{ label: "Notes", description: "Use connected notes." },
					{ label: "Files", description: "Use workspace files." },
					{ label: "Web", description: "Use online sources." },
				],
			},
		]);
	});

	it("rejects the superseded multi-select question contract", () => {
		expect(
			getHostedUserQuestionRequest({
				id: "assistant-multi-select",
				role: "assistant",
				parts: [
					{
						type: "tool-request_user_input",
						toolCallId: "question-multi-select",
						state: "input-available",
						input: {
							questions: [{ ...questions[0], type: "multi_select" }],
						},
					},
				],
			}),
		).toBeNull();
	});

	it("rejects duplicate question IDs and options", () => {
		const invalidMessage = {
			id: "assistant-invalid-questionnaire",
			role: "assistant" as const,
			parts: [
				{
					type: "tool-request_user_input" as const,
					toolCallId: "questionnaire-invalid",
					state: "input-available" as const,
					input: {
						questions: [
							questions[0],
							{
								...questions[0],
								options: [
									{ label: "All notes", description: "Use all notes." },
									{ label: "All notes", description: "Use every note." },
								],
							},
						],
					},
				},
			],
		};

		expect(getHostedUserQuestionRequest(invalidMessage)).toBeNull();
	});

	it("rejects the superseded one-question shape", () => {
		expect(
			getHostedUserQuestionRequest({
				id: "assistant-old-question",
				role: "assistant",
				parts: [
					{
						type: "tool-request_user_input",
						toolCallId: "question-old",
						state: "input-available",
						input: {
							question: "Which scope should I use?",
							responseType: "choice",
							options: [
								{
									label: "Current note",
									description: "Use only the current note.",
								},
								{ label: "All notes", description: "Use all available notes." },
							],
						},
					},
				],
			}),
		).toBeNull();
	});
});
