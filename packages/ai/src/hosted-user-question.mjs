import { tool } from "ai";
import { z } from "zod";
import { CHAT_MODE } from "./chat-mode.mjs";
import { decodeTrustedStoredUiMessage } from "./ui-message-codec.mjs";

export const HOSTED_REQUEST_USER_INPUT_TOOL_NAME = "request_user_input";

const questionOptionSchema = z
	.object({
		label: z.string().trim().min(1).max(120),
		description: z.string().trim().min(1).max(300),
	})
	.strict();

const userQuestionSchema = z
	.object({
		id: z.string().trim().min(1).max(64),
		question: z.string().trim().min(1).max(2_000),
		options: z.array(questionOptionSchema).min(2).max(3),
	})
	.strict();

const requestUserInputSchema = z
	.object({
		questions: z
			.array(userQuestionSchema)
			.min(1)
			.max(3)
			.describe("One to three concise questions for the user."),
	})
	.strict()
	.superRefine((request, context) => {
		if (
			new Set(request.questions.map(({ id }) => id)).size !==
			request.questions.length
		) {
			context.addIssue({
				code: "custom",
				path: ["questions"],
				message: "Question IDs must be unique.",
			});
		}
		request.questions.forEach((question, index) => {
			if (
				new Set(question.options.map(({ label }) => label)).size ===
				question.options.length
			) {
				return;
			}
			context.addIssue({
				code: "custom",
				path: ["questions", index, "options"],
				message: "Question options must be unique.",
			});
		});
	});

const userQuestionAnswerSchema = z
	.object({
		answer: z.string().trim().min(1),
	})
	.strict();

const getQuestion = (input) => {
	const result = requestUserInputSchema.safeParse(input);
	return result.success ? result.data : null;
};

const getQuestionPart = (part) => {
	if (
		part.type !== `tool-${HOSTED_REQUEST_USER_INPUT_TOOL_NAME}` ||
		part.state !== "input-available" ||
		typeof part.toolCallId !== "string"
	) {
		return null;
	}
	const question = getQuestion(part.input);
	return question ? { part, question } : null;
};

const getQuestionAnswerPart = (part) => {
	if (
		part.type !== `tool-${HOSTED_REQUEST_USER_INPUT_TOOL_NAME}` ||
		part.state !== "output-available" ||
		typeof part.toolCallId !== "string"
	) {
		return null;
	}
	const question = getQuestion(part.input);
	const answer = userQuestionAnswerSchema.safeParse(part.output);
	return question && answer.success
		? { answer: answer.data.answer, part, question }
		: null;
};

const optionArraysMatch = (left, right) =>
	left.length === right.length &&
	left.every((option, index) => {
		const candidate = right[index];
		return (
			candidate &&
			option.label === candidate.label &&
			option.description === candidate.description
		);
	});

const questionsMatch = (left, right) =>
	left.length === right.length &&
	left.every((question, index) => {
		const candidate = right[index];
		return (
			candidate &&
			question.id === candidate.id &&
			question.question === candidate.question &&
			optionArraysMatch(question.options, candidate.options)
		);
	});

export const hostedUserQuestionDecisionsMatch = (left, right) =>
	left.type === "user_question" &&
	right.type === "user_question" &&
	left.assistantMessageId === right.assistantMessageId &&
	left.toolCallId === right.toolCallId &&
	questionsMatch(left.questions, right.questions);

const createHostedRequestUserInputTool = () =>
	tool({
		description:
			"Pause the current run for one to three concise single-choice questions when proceeding would require a consequential guess. When several independent choices may apply, ask one Yes/No question for each choice. Provide two or three mutually exclusive options with a concise description. Put the recommended option first and suffix its label with ' (Recommended)'. The client adds a free-form Other response. Do not request passwords, tokens, credentials, or other secrets in chat.",
		inputSchema: requestUserInputSchema,
		metadata: {
			ui: {
				icon: "file-text",
				running: "Waiting for your answer",
				complete: "Question answered",
				subtitleKeys: ["question"],
			},
		},
	});

export const createHostedUserQuestionTools = (chatMode) =>
	chatMode === CHAT_MODE.PLAN
		? { request_user_input: createHostedRequestUserInputTool() }
		: {};

export const getHostedUserQuestionRequest = (message) => {
	if (message?.role !== "assistant" || !Array.isArray(message.parts)) {
		return null;
	}
	const requests = message.parts.map(getQuestionPart).filter(Boolean);
	if (requests.length > 1) {
		throw new Error(
			"Assistant execution requested multiple user questions in one step.",
		);
	}
	const [request] = requests;
	return request
		? {
				type: "user_question",
				assistantMessageId: message.id,
				toolCallId: request.part.toolCallId,
				...request.question,
			}
		: null;
};

export const isHostedUserQuestionAnswerMessage = (message) =>
	message?.role === "assistant" &&
	Array.isArray(message.parts) &&
	message.parts.map(getQuestionAnswerPart).filter(Boolean).length === 1;

export const getHostedUserQuestionAnswer = ({ message, decision }) => {
	if (
		message?.id !== decision.assistantMessageId ||
		message.role !== "assistant" ||
		!Array.isArray(message.parts)
	) {
		return null;
	}
	const answers = message.parts
		.map((part) => {
			const answeredQuestion = getQuestionAnswerPart(part);
			if (
				!answeredQuestion ||
				answeredQuestion.part.toolCallId !== decision.toolCallId
			) {
				return null;
			}
			return questionsMatch(
				answeredQuestion.question.questions,
				decision.questions,
			)
				? answeredQuestion.answer
				: null;
		})
		.filter((answer) => answer !== null);
	return answers.length === 1 ? answers[0] : null;
};

export const resolveHostedUserQuestionMessage = ({
	message,
	decision,
	answer,
}) => {
	if (
		message.id !== decision.assistantMessageId ||
		message.role !== "assistant"
	) {
		return null;
	}
	const requests = message.parts.map(getQuestionPart).filter(Boolean);
	const [request] = requests;
	const decisionQuestion = {
		questions: decision.questions,
	};
	if (
		requests.length !== 1 ||
		request.part.toolCallId !== decision.toolCallId ||
		!questionsMatch(request.question.questions, decisionQuestion.questions)
	) {
		return null;
	}
	const parts = message.parts.map((part) => {
		const pendingQuestion = getQuestionPart(part);
		if (!pendingQuestion) {
			return part;
		}
		return {
			...pendingQuestion.part,
			state: "output-available",
			output: { answer },
		};
	});
	return { ...message, parts };
};

export const createCanonicalHostedUserQuestionAnswer = ({
	answer,
	decision,
	storedMessage,
}) => {
	if (
		storedMessage?.role !== "assistant" ||
		storedMessage.id !== decision.assistantMessageId
	) {
		throw new Error("Pending user question message was not found.");
	}
	const message = decodeTrustedStoredUiMessage(storedMessage);
	const resolvedMessage = resolveHostedUserQuestionMessage({
		message,
		decision,
		answer,
	});
	if (!resolvedMessage) {
		throw new Error("Pending user question does not match the answer.");
	}
	return resolvedMessage;
};
