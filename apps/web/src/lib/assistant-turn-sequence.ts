import type { OpenaiResponsesTextProviderMetadata } from "@ai-sdk/openai";
import { isToolUIPart, type TextUIPart, type UIMessage } from "ai";

type AssistantMessagePart = UIMessage["parts"][number];

type AssistantTextPhase = NonNullable<
	OpenaiResponsesTextProviderMetadata["openai"]["phase"]
>;

export type AssistantActivityUnit =
	| {
			kind: "commentary";
			messageId: string;
			part: TextUIPart;
			sourceIndex: number;
	  }
	| {
			kind: "activity";
			messageId: string;
			parts: AssistantMessagePart[];
			sourceIndex: number;
	  };

const getAssistantTextPhase = (part: TextUIPart): AssistantTextPhase | null => {
	const phase = part.providerMetadata?.openai?.phase;
	return phase === "commentary" || phase === "final_answer" ? phase : null;
};

const isAssistantActivityPart = (part: AssistantMessagePart) =>
	part.type === "reasoning" || isToolUIPart(part);

export const getAssistantTurnSequence = (message: UIMessage) => {
	const activityUnits: AssistantActivityUnit[] = [];
	const finalTextParts: TextUIPart[] = [];
	let pendingActivityParts: AssistantMessagePart[] = [];
	let pendingActivitySourceIndex = 0;

	const flushActivityParts = () => {
		if (pendingActivityParts.length === 0) {
			return;
		}

		activityUnits.push({
			kind: "activity",
			messageId: message.id,
			parts: pendingActivityParts,
			sourceIndex: pendingActivitySourceIndex,
		});
		pendingActivityParts = [];
	};

	for (const [sourceIndex, part] of message.parts.entries()) {
		if (part.type === "text") {
			const phase = getAssistantTextPhase(part);
			if (phase === "commentary") {
				flushActivityParts();
				if (part.text.trim().length > 0) {
					activityUnits.push({
						kind: "commentary",
						messageId: message.id,
						part,
						sourceIndex,
					});
				}
				continue;
			}

			if (part.text.trim().length > 0) {
				finalTextParts.push(part);
			}
			continue;
		}

		if (!isAssistantActivityPart(part)) {
			continue;
		}

		if (pendingActivityParts.length === 0) {
			pendingActivitySourceIndex = sourceIndex;
		}
		pendingActivityParts.push(part);
	}

	flushActivityParts();

	return { activityUnits, finalTextParts };
};

export const getAssistantFinalText = (message: UIMessage) =>
	getAssistantTurnSequence(message)
		.finalTextParts.map((part) => part.text)
		.join("\n\n")
		.trim();
