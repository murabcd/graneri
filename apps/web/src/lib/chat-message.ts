import {
	type ChatMessageMetadata,
	parseChatMessageMetadata,
} from "@workspace/ai/chat-message-metadata";
import { isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";

export { type ChatMessageMetadata, parseChatMessageMetadata };

export type ChatGeneratedArtifact = {
	filename?: string;
	mediaType: string;
	url: string;
};

const generatedArtifactSchema = z.object({
	filename: z.string().optional(),
	mediaType: z.string().min(1),
	url: z.string().min(1),
});

export const parseGeneratedArtifact = (
	value: unknown,
): ChatGeneratedArtifact | null => {
	const result = generatedArtifactSchema.safeParse(value);
	return result.success ? result.data : null;
};

const extractTextParts = (message: UIMessage) =>
	message.parts.filter(
		(part): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
			part.type === "text" &&
			typeof part.text === "string" &&
			part.text.length > 0,
	);

export const extractFileParts = (message: UIMessage) =>
	message.parts.filter(
		(part): part is Extract<(typeof message.parts)[number], { type: "file" }> =>
			part.type === "file" &&
			typeof part.url === "string" &&
			part.url.length > 0,
	);

export const extractToolParts = (message: UIMessage) =>
	message.parts.filter(isToolUIPart);

export const extractGeneratedArtifacts = (
	message: UIMessage,
): ChatGeneratedArtifact[] =>
	extractToolParts(message).flatMap((part) => {
		if (part.type !== "tool-generate_image") {
			return [];
		}

		if (!("state" in part) || part.state !== "output-available") {
			return [];
		}

		const artifact = parseGeneratedArtifact(
			"output" in part ? part.output : null,
		);

		return artifact ? [artifact] : [];
	});

export const extractReasoningParts = (message: UIMessage) =>
	message.parts.filter((part) => part.type === "reasoning");

export const getChatText = (message: UIMessage) =>
	extractTextParts(message)
		.map((part) => part.text)
		.join("\n\n")
		.trim();

export const getChatMessageMetadata = (
	message: UIMessage,
): ChatMessageMetadata | null => parseChatMessageMetadata(message.metadata);
