import { parseArtifactToolOutput } from "@workspace/ai/artifact-authoring-contract";
import {
	type ChatMessageMetadata,
	parseChatMessageMetadata,
} from "@workspace/ai/chat-message-metadata";
import { isToolUIPart, type UIMessage } from "ai";

export { type ChatMessageMetadata, parseChatMessageMetadata };

export type ChatGeneratedArtifact = {
	filename: string;
	mediaType: string;
	providerMetadata: {
		graneri: {
			generatedBy: "ai";
			storageId: string;
		};
	};
	sizeBytes: number;
	url: string;
};

export const parseGeneratedArtifacts = (
	value: unknown,
): ChatGeneratedArtifact[] => parseArtifactToolOutput(value)?.artifacts ?? [];

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
		if (!("state" in part) || part.state !== "output-available") {
			return [];
		}

		const artifacts = parseGeneratedArtifacts(
			"output" in part ? part.output : null,
		);

		return artifacts;
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
