import { tool } from "ai";
import { z } from "zod";

export const HOSTED_REQUEST_USER_INPUT_TOOL_NAME = "request_user_input";

const questionOptionSchema = z.object({
	label: z.string().trim().min(1).max(120),
	description: z.string().trim().min(1).max(240).optional(),
});

const requestUserInputSchema = z
	.object({
		question: z
			.string()
			.trim()
			.min(1)
			.max(2_000)
			.describe("One focused question the user must answer."),
		responseType: z
			.enum(["text", "choice"])
			.describe(
				"Use choice only when the valid answers are known and bounded.",
			),
		options: z.array(questionOptionSchema).min(2).max(5).optional(),
		consequence: z
			.string()
			.trim()
			.min(1)
			.max(500)
			.optional()
			.describe("Why this answer is required or what it will affect."),
	})
	.superRefine((request, context) => {
		if (request.responseType === "choice" && !request.options) {
			context.addIssue({
				code: "custom",
				path: ["options"],
				message: "Choice questions require options.",
			});
		}
		if (request.responseType === "text" && request.options) {
			context.addIssue({
				code: "custom",
				path: ["options"],
				message: "Text questions cannot include options.",
			});
		}
		if (
			request.options &&
			new Set(request.options.map(({ label }) => label)).size !==
				request.options.length
		) {
			context.addIssue({
				code: "custom",
				path: ["options"],
				message: "Question options must be unique.",
			});
		}
	});

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

const questionsMatch = (left, right) =>
	left.question === right.question &&
	left.responseType === right.responseType &&
	left.consequence === right.consequence &&
	(left.options?.length ?? 0) === (right.options?.length ?? 0) &&
	(left.options ?? []).every(
		(option, index) =>
			option.label === right.options?.[index]?.label &&
			option.description === right.options[index]?.description,
	);

export const createHostedRequestUserInputTool = () =>
	tool({
		description:
			"Pause the current run for one focused answer when proceeding would require a consequential guess. Use a bounded choice when valid answers are known; otherwise request text. Explain the consequence when it is not obvious. Do not request passwords, tokens, credentials, or other secrets in chat.",
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

export const resolveHostedUserQuestionMessage = ({ message, decision }) => {
	if (
		message.id !== decision.assistantMessageId ||
		message.role !== "assistant"
	) {
		return null;
	}
	const requests = message.parts.map(getQuestionPart).filter(Boolean);
	const [request] = requests;
	const decisionQuestion = {
		question: decision.question,
		responseType: decision.responseType,
		...(decision.options && { options: decision.options }),
		...(decision.consequence && { consequence: decision.consequence }),
	};
	if (
		requests.length !== 1 ||
		request.part.toolCallId !== decision.toolCallId ||
		!questionsMatch(request.question, decisionQuestion)
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
			output: { answered: true },
		};
	});
	return { ...message, parts };
};
