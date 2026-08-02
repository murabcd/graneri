import { tool } from "ai";
import { z } from "zod";

export const HOSTED_REQUEST_USER_INPUT_TOOL_NAME = "request_user_input";

const requestUserInputSchema = z.object({
	question: z
		.string()
		.trim()
		.min(1)
		.max(2_000)
		.describe("One focused question the user can answer in the chat composer."),
});

const getQuestion = (input) => {
	const result = requestUserInputSchema.safeParse(input);
	return result.success ? result.data.question : null;
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

export const createHostedRequestUserInputTool = () =>
	tool({
		description:
			"Pause the current assistant run to ask the user one focused question that must be answered before work can continue. Use this only when proceeding without the answer would require a consequential guess. The user answers in the existing chat composer.",
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
				question: request.question,
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
	if (
		requests.length !== 1 ||
		request.part.toolCallId !== decision.toolCallId ||
		request.question !== decision.question
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
